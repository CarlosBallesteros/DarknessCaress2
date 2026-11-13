import type { Pool } from "pg";
import { projectEngineConfig } from "../../game/config.js";
import { applyMoves, checkVictory } from "../../game/apply.js";
import { pathTo } from "../../game/reach.js";
import type { AppliedTurn } from "../../game/apply.js";
import type { Board, GameEngineConfig, Move, Unit } from "../../game/types.js";
import type { AppConfig } from "../../config/index.js";
import type { GameRow } from "../games/dto.js";
import {
  computeSingleEnemyOrder,
  type DestinationOrder,
  type Difficulty,
} from "./policy.js";

export interface AiActionDto {
  unitId: string;
  path: [number, number][];
  action:
    { type: "attack"; targetId: string } | { type: "heal"; targetId: string } | { type: "wait" };
  outcome: {
    targetId: string;
    damage: number;
    targetHp: number;
    targetDied: boolean;
    counter: { damage: number; attackerHp: number } | null;
  } | null;
}

function findUnit(units: Unit[], id: string): Unit | undefined {
  return units.find((u) => u.id === id);
}

export function expandOrdersToMoves(
  board: Board,
  units: Unit[],
  orders: DestinationOrder[],
  cfg: GameEngineConfig,
): Move[] {
  const working = units.map((u) => ({ ...u }));
  const moves: Move[] = [];

  for (const order of orders) {
    const unit = findUnit(working, order.unitId);
    if (!unit) continue;
    const to = order.to ?? [unit.x, unit.y];
    let path = pathTo(board, working, unit, [to[0], to[1]], cfg);
    let action = order.action;

    // Defensive: if expansion/legality cannot be satisfied, degrade to legal wait-in-place
    if (!path) {
      path = [[unit.x, unit.y]];
      action = { type: "wait" };
    }

    moves.push({ unitId: order.unitId, path, action });

    // evolve working snapshot for subsequent expansions (earlier moves claim/vacate in order)
    const end = path[path.length - 1];
    unit.x = end[0];
    unit.y = end[1];
  }

  return moves;
}

type EngineEvent = AppliedTurn["events"][number];

export function toAiActions(
  moves: Move[],
  events: AppliedTurn["events"],
  finalUnits: Unit[],
): AiActionDto[] {
  let idx = 0;
  const actions: AiActionDto[] = [];

  const peek = (): EngineEvent | undefined => events[idx];
  const consume = (): EngineEvent => {
    const ev = events[idx];
    idx += 1;
    return ev;
  };

  for (const move of moves) {
    // optional moved event for this unit
    const movedEv = peek();
    if (movedEv && movedEv.kind === "moved" && movedEv.unitId === move.unitId) {
      consume();
    }

    if (move.action.type === "wait") {
      const waitEv = peek();
      if (waitEv && waitEv.kind === "wait" && waitEv.unitId === move.unitId) {
        consume();
      }
      actions.push({
        unitId: move.unitId,
        path: move.path,
        action: move.action,
        outcome: null,
      });
      continue;
    }

    if (move.action.type === "attack") {
      const attackEv = consume() as Extract<EngineEvent, { kind: "attack" }>;
      let targetDied = false;
      let counter: { damage: number; attackerHp: number } | null = null;

      const afterAttack = peek();
      if (afterAttack && afterAttack.kind === "died" && afterAttack.unitId === attackEv.targetId) {
        consume();
        targetDied = true;
      } else if (
        afterAttack &&
        afterAttack.kind === "counter" &&
        afterAttack.attackerId === move.unitId
      ) {
        const counterEv = consume() as Extract<EngineEvent, { kind: "counter" }>;
        counter = { damage: counterEv.damage, attackerHp: counterEv.targetHp };
        const afterCounter = peek();
        if (afterCounter && afterCounter.kind === "died" && afterCounter.unitId === move.unitId) {
          consume(); // attacker died from counter
        }
      }

      actions.push({
        unitId: move.unitId,
        path: move.path,
        action: move.action,
        outcome: {
          targetId: attackEv.targetId,
          damage: attackEv.damage,
          targetHp: attackEv.targetHp,
          targetDied,
          counter,
        },
      });
      continue;
    }

    if (move.action.type === "heal") {
      const healEv = consume() as Extract<EngineEvent, { kind: "heal" }>;
      actions.push({
        unitId: move.unitId,
        path: move.path,
        action: move.action,
        outcome: {
          targetId: healEv.targetId,
          damage: healEv.healed,
          targetHp: healEv.targetHp,
          targetDied: false,
          counter: null,
        },
      });
      continue;
    }
  }

  void finalUnits; // attackerHp read from event/state context per engine mapping note
  return actions;
}

export interface AiTurnResult {
  applied: boolean;
  status?: "player_turn" | "lost";
}

function cloneUnits(units: Unit[]): Unit[] {
  return units.map((u) => ({ ...u }));
}

export async function runAiTurn(
  pool: Pool,
  config: AppConfig,
  gameId: string,
): Promise<AiTurnResult> {
  const rowRes = await pool.query<GameRow>("SELECT * FROM games WHERE id = $1", [gameId]);
  const row = rowRes.rows[0];
  if (!row || row.status !== "ai_turn") {
    return { applied: false };
  }

  const board = row.board as Board;
  let currentUnits = (row.units as Unit[]).map((u) => ({ ...u }));
  const engineConfig = projectEngineConfig(
    config as unknown as Parameters<typeof projectEngineConfig>[0],
  );
  const difficulty = row.difficulty as Difficulty;

  try {
    const claimed = new Set<string>();
    const moves: Move[] = [];
    const allEvents: AppliedTurn["events"] = [];

    const enemies = currentUnits
      .filter((u) => u.side === "enemy" && u.hp > 0)
      .map((u) => u.id)
      .sort((a, b) => a.localeCompare(b));

    for (const enemyId of enemies) {
      const unit = findUnit(currentUnits, enemyId);
      if (!unit || unit.side !== "enemy" || unit.hp <= 0) {
        continue;
      }

      const order = computeSingleEnemyOrder(
        board,
        currentUnits,
        unit,
        difficulty,
        engineConfig,
        claimed,
      );

      let move = expandOrdersToMoves(board, currentUnits, [order], engineConfig)[0];
      if (!move) {
        move = { unitId: unit.id, path: [[unit.x, unit.y]], action: { type: "wait" } };
      }

      let applied = applyMoves({ board, units: currentUnits }, [move], "enemy", engineConfig);
      if (!applied.ok) {
        const waitMove: Move = {
          unitId: unit.id,
          path: [[unit.x, unit.y]],
          action: { type: "wait" },
        };
        applied = applyMoves({ board, units: currentUnits }, [waitMove], "enemy", engineConfig);
        if (!applied.ok) {
          await pool.query(
            `UPDATE games SET ai_last_error = $2, updated_at = now() WHERE id = $1 AND status = 'ai_turn'`,
            [gameId, applied.error],
          );
          return { applied: false };
        }
        move = waitMove;
      }

      moves.push(move);
      allEvents.push(...applied.result.events);
      currentUnits = cloneUnits(applied.result.state.units);

      const after = findUnit(currentUnits, enemyId);
      if (after && after.hp > 0) {
        claimed.add(`${after.x},${after.y}`);
      }
    }

    const victory = checkVictory(currentUnits);
    const nextStatus: "player_turn" | "lost" = victory === "enemy" ? "lost" : "player_turn";
    const lastAiActions = toAiActions(moves, allEvents, currentUnits);

    const updateRes = await pool.query(
      `UPDATE games
       SET status = $2,
           units = $3::jsonb,
           board = $4::jsonb,
           turn_number = turn_number + 1,
           last_ai_actions = $5::jsonb,
           ai_last_error = NULL,
           updated_at = now()
       WHERE id = $1 AND status = 'ai_turn'
       RETURNING id`,
      [
        gameId,
        nextStatus,
        JSON.stringify(currentUnits),
        JSON.stringify(board),
        JSON.stringify(lastAiActions),
      ],
    );

    if ((updateRes.rowCount ?? 0) === 0) {
      return { applied: false };
    }

    return { applied: true, status: nextStatus };
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI turn failed";
    await pool
      .query(
        `UPDATE games SET ai_last_error = $2, updated_at = now() WHERE id = $1 AND status = 'ai_turn'`,
        [gameId, message],
      )
      .catch(() => {});
    return { applied: false };
  }
}
