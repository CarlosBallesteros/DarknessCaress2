import { isPathLegal, manhattan, tileKey } from "./reach.js";
import type { Board, Move, Side, Unit } from "./types.js";
import type { GameEngineConfig } from "./types.js";

export interface AppliedTurn {
  events: Array<
    | {
        kind: "moved";
        unitId: string;
        from: [number, number];
        to: [number, number];
      }
    | {
        kind: "attack";
        attackerId: string;
        targetId: string;
        damage: number;
        targetHp: number;
      }
    // targetId = the counterer; damage is dealt to attackerId
    | {
        kind: "counter";
        attackerId: string;
        targetId: string;
        damage: number;
        targetHp: number;
      }
    | {
        kind: "heal";
        healerId: string;
        targetId: string;
        healed: number;
        targetHp: number;
      }
    | { kind: "died"; unitId: string }
    | { kind: "wait"; unitId: string }
  >;
  state: { board: Board; units: Unit[] }; // NEW state; caller persists it
}

type Outcome = { ok: true; result: AppliedTurn } | { ok: false; error: string };

function unitById(units: Unit[], id: string): Unit | undefined {
  return units.find((u) => u.id === id);
}

/** An entry relocates when its final tile differs from the unit's pre-move tile. */
function finalTile(move: Move): [number, number] {
  return move.path[move.path.length - 1] as [number, number];
}

/**
 * Executes a turn bundle for one side. Static (whole-bundle) validation runs
 * first — a failing bundle errors with the pre-state untouched. Execution then
 * resolves entries in strict sequential order on a private copy; a runtime
 * failure mid-bundle (e.g. the target died to an earlier entry) discards the
 * copy, keeping the atomic "one bad move ⇒ state untouched" guarantee.
 */
export function applyMoves(
  state: { board: Board; units: Unit[] },
  moves: Move[],
  side: Side,
  cfg: GameEngineConfig,
): Outcome {
  // ---- whole-bundle validation (pre-move state) ----
  // Message rows for non-capable classes, unknown action types and unknown
  // target ids are part of the amended catalogue in 02 (docs commit 9c04ffd).
  const seen = new Set<string>();
  for (const move of moves) {
    const unit = unitById(state.units, move.unitId);
    if (unit === undefined) {
      return { ok: false, error: `unknown unit ${move.unitId}` };
    }
    if (unit.side !== side) {
      return { ok: false, error: `${move.unitId} belongs to the other army` };
    }
    if (unit.acted) {
      return { ok: false, error: `${move.unitId} already acted this turn` };
    }
    if (seen.has(move.unitId)) {
      return { ok: false, error: `${move.unitId} appears twice` };
    }
    seen.add(move.unitId);

    const action = move.action as { type?: string; targetId?: string };
    if (action.type === "attack") {
      if (!action.targetId) {
        return { ok: false, error: "attack requires a target" };
      }
      const stats = cfg.classes[unit.class];
      if (stats.atk <= 0) {
        return { ok: false, error: `${unit.class} cannot attack` };
      }
      const target = unitById(state.units, action.targetId);
      if (target === undefined) {
        return { ok: false, error: `unknown unit ${action.targetId}` };
      }
      if (target.side === unit.side) {
        return {
          ok: false,
          error: `${action.targetId} is not a valid attack target`,
        };
      }
      const [fx, fy] = finalTile(move);
      const distance = manhattan(fx, fy, target.x, target.y);
      if (!stats.range.includes(distance)) {
        return {
          ok: false,
          error: `${unit.class} cannot attack a unit at ${distance} tiles`,
        };
      }
    } else if (action.type === "heal") {
      if (!action.targetId) {
        return { ok: false, error: "heal requires a target" };
      }
      if (cfg.classes[unit.class].healAmount === undefined) {
        return { ok: false, error: `${unit.class} cannot heal` };
      }
      if (unitById(state.units, action.targetId) === undefined) {
        return { ok: false, error: `unknown unit ${action.targetId}` };
      }
    } else if (action.type !== "wait") {
      return { ok: false, error: `unknown action "${String(action.type)}"` };
    }
  }

  // ---- landing-tile rule: claim conflicts, then vacated-earlier ends ----
  const claims = new Map<string, string>();
  for (const move of moves) {
    const unit = unitById(state.units, move.unitId) as Unit;
    const [fx, fy] = finalTile(move);
    if (fx === unit.x && fy === unit.y) {
      continue; // no relocation — wait-like entries claim nothing
    }
    const key = tileKey(fx, fy);
    if (claims.has(key)) {
      return { ok: false, error: `tile (${fx},${fy}) is claimed by two moves` };
    }
    claims.set(key, unit.id);
  }
  for (let i = 0; i < moves.length; i++) {
    const move = moves[i] as Move;
    const unit = unitById(state.units, move.unitId) as Unit;
    const [fx, fy] = finalTile(move);
    if (fx === unit.x && fy === unit.y) {
      continue;
    }
    // A bundle mate standing on the landing tile (pre-move state) vacates it
    // only when its own entry relocates — and only an EARLIER vacating entry
    // makes the "frees EARLIER" message factually right. A later entry's tile
    // simply stays occupied and is rejected by the path check.
    for (let j = 0; j < i; j++) {
      const earlier = moves[j] as Move;
      const earlierUnit = unitById(state.units, earlier.unitId) as Unit;
      const [efx, efy] = finalTile(earlier);
      if (
        earlierUnit.x === fx &&
        earlierUnit.y === fy &&
        !(efx === fx && efy === fy)
      ) {
        return {
          ok: false,
          error: `tile (${fx},${fy}) frees EARLIER in this bundle and cannot be landed on`,
        };
      }
    }
  }

  // ---- path legality against the pre-move state ----
  for (const move of moves) {
    const unit = unitById(state.units, move.unitId) as Unit;
    const error = isPathLegal(state.board, state.units, unit, move.path, cfg);
    if (error !== null) {
      return { ok: false, error };
    }
  }

  // ---- sequential execution on a private copy ----
  const board: Board = { tiles: state.board.tiles.map((row) => [...row]) };
  const units = state.units.map((u) => ({ ...u }));
  const events: AppliedTurn["events"] = [];

  for (const move of moves) {
    const unit = unitById(units, move.unitId) as Unit;
    const from: [number, number] = [unit.x, unit.y];
    const [fx, fy] = finalTile(move);
    if (fx !== unit.x || fy !== unit.y) {
      unit.x = fx;
      unit.y = fy;
      events.push({ kind: "moved", unitId: unit.id, from, to: [fx, fy] });
    }

    const action = move.action as { type: string; targetId?: string };
    if (action.type === "wait") {
      unit.acted = true;
      events.push({ kind: "wait", unitId: unit.id });
      continue;
    }

    const target = unitById(units, action.targetId ?? "");

    if (action.type === "heal") {
      // heal target validity is runtime: an ally may have moved or been
      // healed by an earlier entry; unknown/dead/wrong-side/non-adjacent/
      // unwounded targets all reject with the catalogue's single message.
      const healable =
        target !== undefined &&
        target.side === unit.side &&
        manhattan(unit.x, unit.y, target.x, target.y) === 1 &&
        target.hp < target.maxHp;
      if (!healable) {
        return { ok: false, error: "heal target must be adjacent and wounded" };
      }
      const healed = Math.min(
        cfg.classes[unit.class].healAmount as number,
        target.maxHp - target.hp,
      );
      target.hp += healed;
      unit.acted = true;
      events.push({
        kind: "heal",
        healerId: unit.id,
        targetId: target.id,
        healed,
        targetHp: target.hp,
      });
      continue;
    }

    // attack — target may have died to an earlier entry ("must still be alive")
    if (target === undefined) {
      return {
        ok: false,
        error: `${action.targetId} is not a valid attack target`,
      };
    }
    const stats = cfg.classes[unit.class];
    const damage = Math.max(0, stats.atk - cfg.classes[target.class].def);
    target.hp -= damage;
    unit.acted = true;
    events.push({
      kind: "attack",
      attackerId: unit.id,
      targetId: target.id,
      damage,
      targetHp: target.hp,
    });
    if (target.hp <= 0) {
      units.splice(units.indexOf(target), 1);
      events.push({ kind: "died", unitId: target.id });
      continue;
    }
    const defenderStats = cfg.classes[target.class];
    const counterDistance = manhattan(target.x, target.y, unit.x, unit.y);
    if (
      defenderStats.atk > 0 &&
      defenderStats.range.includes(counterDistance)
    ) {
      const counterDamage = Math.max(
        0,
        defenderStats.atk - cfg.classes[unit.class].def,
      );
      unit.hp -= counterDamage;
      events.push({
        kind: "counter",
        attackerId: unit.id,
        targetId: target.id,
        damage: counterDamage,
        targetHp: unit.hp,
      });
      if (unit.hp <= 0) {
        units.splice(units.indexOf(unit), 1);
        events.push({ kind: "died", unitId: unit.id });
      }
    }
  }

  return {
    ok: true,
    result: {
      events,
      state: { board, units },
    },
  };
}

/**
 * "player" = the enemy army is wiped; "enemy" = the player army is wiped.
 * Damage is never simultaneous, so both armies cannot reach zero.
 */
export function checkVictory(units: Unit[]): "player" | "enemy" | null {
  const playerAlive = units.some((u) => u.side === "player");
  const enemyAlive = units.some((u) => u.side === "enemy");
  if (!enemyAlive) {
    return "player";
  }
  if (!playerAlive) {
    return "enemy";
  }
  return null;
}
