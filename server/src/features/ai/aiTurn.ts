import { applyMoves, checkVictory, type AppliedTurn } from "../../game/apply";
import { pathTo } from "../../game/reach";
import type { Board, GameEngineConfig, Move, Side, Unit } from "../../game/types";
import { config } from "../../config";
import { pool } from "../../db/pool";
import { finishActiveJob, tryStartActiveJob } from "../games/activeJobs";
import { findGameById } from "../games/repo";
import { chooseOrderForUnit, type Difficulty } from "./policy";

type AiOutcome = {
  targetId: string;
  damage: number;
  targetHp: number;
  targetDied: boolean;
  counter: { damage: number; attackerHp: number } | null;
} | null;

interface AiActionDto {
  unitId: string;
  path: [number, number][];
  action:
    | { type: "attack"; targetId: string }
    | { type: "heal"; targetId: string }
    | { type: "wait" };
  outcome: AiOutcome;
}

function outcomeFromEvents(move: Move, events: AppliedTurn["events"]): AiOutcome {
  if (move.action.type === "wait") return null;
  if (move.action.type === "heal") {
    const healEv = [...events]
      .reverse()
      .find((e) => e.kind === "heal" && e.healerId === move.unitId);
    if (!healEv || healEv.kind !== "heal") return null;
    return {
      targetId: healEv.targetId,
      damage: healEv.healed,
      targetHp: healEv.targetHp,
      targetDied: false,
      counter: null,
    };
  }
  // attack
  const attackEv = events.find(
    (e) => e.kind === "attack" && e.attackerId === move.unitId && "targetId" in e,
  );
  if (!attackEv || attackEv.kind !== "attack") return null;
  const counterEv = events.find(
    (e) => e.kind === "counter" && e.targetId === move.unitId && e.attackerId === attackEv.targetId,
  );
  let attackerHpAfter: number | null = null;
  if (counterEv && counterEv.kind === "counter") {
    attackerHpAfter = counterEv.targetHp;
  }
  return {
    targetId: attackEv.targetId,
    damage: attackEv.damage,
    targetHp: attackEv.targetHp,
    targetDied: attackEv.targetHp <= 0,
    counter:
      counterEv && counterEv.kind === "counter" && attackerHpAfter !== null
        ? { damage: counterEv.damage, attackerHp: attackerHpAfter }
        : null,
  };
}

function resetAllActed(units: Unit[]): Unit[] {
  return units.map((u) => ({ ...u, acted: false }));
}

function expandOrderToMove(
  state: { board: Board; units: Unit[] },
  unit: Unit,
  order: { to?: [number, number]; action: Move["action"] },
  cfg: GameEngineConfig,
): Move | null {
  const to = order.to ?? [unit.x, unit.y];
  const path = pathTo(state.board, state.units, unit, [to[0], to[1]], cfg);
  if (!path) return null;
  return { unitId: unit.id, path, action: order.action };
}

function waitMove(unit: Unit): Move {
  return { unitId: unit.id, path: [[unit.x, unit.y]], action: { type: "wait" } };
}

export async function runAiTurnJob(gameId: string): Promise<void> {
  if (!tryStartActiveJob(gameId)) return;
  try {
    const row = await findGameById(gameId);
    if (!row || row.status !== "ai_turn") return;

    const difficulty = row.difficulty as Difficulty;
    const engineCfg = {
      boardSize: config.boardSize,
      classes: config.classes as unknown as GameEngineConfig["classes"],
    } as GameEngineConfig;

    let state = { board: row.board as Board, units: (row.units ?? []) as Unit[] };
    const actions: AiActionDto[] = [];
    const claimed = new Set<string>();

    // seed claimed with tiles of completed alive enemy units? none yet; track as we complete
    const enemyIds = state.units
      .filter((u) => u.side === "enemy")
      .map((u) => u.id)
      .sort();

    for (const enemyId of enemyIds) {
      const unitNow = state.units.find((u) => u.id === enemyId);
      if (!unitNow || unitNow.hp <= 0) continue;

      let applied: {
        move: Move;
        events: AppliedTurn["events"];
        nextState: { board: Board; units: Unit[] };
      } | null = null;

      const attemptApply = (candidate: Move): boolean => {
        const res = applyMoves(state, [candidate], "enemy" as Side, engineCfg);
        if (!res.ok) return false;
        applied = { move: candidate, events: res.result.events, nextState: res.result.state };
        return true;
      };

      // primary choice
      const order = chooseOrderForUnit({
        board: state.board,
        units: state.units,
        unit: unitNow,
        difficulty,
        cfg: engineCfg,
        claimed,
      });
      const expanded = expandOrderToMove(state, unitNow, order, engineCfg);
      if (expanded) {
        attemptApply(expanded);
      }

      // fallback: try legal wait if primary failed
      if (!applied) {
        const w = waitMove(unitNow);
        if (!attemptApply(w)) {
          // cannot act; skip (should be rare) - but we must keep going
          continue;
        }
      }

      // record action and advance state
      const usedMove = applied!.move;
      const outcome = outcomeFromEvents(usedMove, applied!.events);
      actions.push({
        unitId: usedMove.unitId,
        path: usedMove.path,
        action: usedMove.action,
        outcome,
      });
      state = applied!.nextState;

      // claim destination of this enemy if still alive
      const survivor = state.units.find((u) => u.id === enemyId && u.side === "enemy" && u.hp > 0);
      if (survivor) {
        claimed.add(`${survivor.x},${survivor.y}`);
      }
    }

    const victory = checkVictory(state.units);
    let status: "player_turn" | "lost" = "player_turn";
    if (victory === "enemy") status = "lost";
    // victory === "player" should not happen from AI turn; treat as player_turn defensively? spec says no ai_turn->won

    let finalUnits = state.units;
    if (status === "player_turn") {
      finalUnits = resetAllActed(finalUnits);
    }

    // conditional persist
    const persisted = await pool.query(
      `UPDATE games
       SET status = $2,
           board = $3::jsonb,
           units = $4::jsonb,
           turn_number = turn_number + 1,
           last_ai_actions = $5::jsonb,
           ai_last_error = NULL,
           updated_at = now()
       WHERE id = $1 AND status = 'ai_turn'`,
      [
        gameId,
        status,
        JSON.stringify(state.board),
        JSON.stringify(finalUnits),
        JSON.stringify(actions),
      ],
    );
    if ((persisted.rowCount ?? 0) === 0) {
      // forfeited/discarded
      return;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI turn failed";
    try {
      await pool.query(
        `UPDATE games
         SET ai_last_error = $2,
             updated_at = now()
         WHERE id = $1 AND status = 'ai_turn'`,
        [gameId, message],
      );
    } catch {
      // best effort
    }
  } finally {
    finishActiveJob(gameId);
  }
}

export function kickOffAiTurn(gameId: string): void {
  void runAiTurnJob(gameId).catch((err) => {
    console.error("unhandled ai turn job error", err);
  });
}
