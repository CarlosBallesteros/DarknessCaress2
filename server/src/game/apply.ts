import { isPathLegal } from "./reach";
import type { Board, GameEngineConfig, Move, Side, Unit } from "./types";

// Turn execution per docs/02: entries are validated and applied one by one
// against a RUNNING COPY of the state (strict sequential order — each entry
// completes fully, including its counter, before the next begins). A failing
// entry rejects the whole bundle: the caller's state is never touched, because
// everything happened on the copy that gets discarded on failure.

export interface AppliedTurn {
  events: Array<
    | { kind: "moved"; unitId: string; from: [number, number]; to: [number, number] }
    | { kind: "attack"; attackerId: string; targetId: string; damage: number; targetHp: number }
    // targetId = the counterer (the original target); targetHp = the original
    // attacker's hp after taking the counter damage
    | { kind: "counter"; attackerId: string; targetId: string; damage: number; targetHp: number }
    | { kind: "heal"; healerId: string; targetId: string; healed: number; targetHp: number }
    | { kind: "died"; unitId: string }
    | { kind: "wait"; unitId: string }
  >;
  state: { board: Board; units: Unit[] }; // NEW state; caller persists it
}

type ApplyResult = { ok: true; result: AppliedTurn } | { ok: false; error: string };

function fail(error: string): ApplyResult {
  return { ok: false, error };
}

function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

// "player" = enemy army wiped (player won). "enemy" = player army wiped.
// Called by feature code after applying one side's moves, never by the engine.
export function checkVictory(units: Unit[]): "player" | "enemy" | null {
  const playerAlive = units.some((u) => u.side === "player" && u.hp > 0);
  const enemyAlive = units.some((u) => u.side === "enemy" && u.hp > 0);
  if (!enemyAlive) return "player";
  if (!playerAlive) return "enemy";
  return null;
}

export function applyMoves(
  state: { board: Board; units: Unit[] },
  moves: Move[],
  side: Side,
  cfg: GameEngineConfig,
): ApplyResult {
  const units: Unit[] = state.units.map((u) => ({ ...u }));
  const board: Board = { tiles: state.board.tiles.map((row) => [...row]) };
  const events: AppliedTurn["events"] = [];
  // ids removed from `units` during THIS bundle — a later entry referencing one
  // is rejected as an invalid target, not as an unknown unit (docs/02 catalogue)
  const dead = new Set<string>();

  // Each unit may act at most once per bundle — a bundle-level rule, checked
  // before anything applies (a duplicate would also double-claim its tile).
  const seen = new Set<string>();
  for (const move of moves) {
    if (seen.has(move.unitId)) return fail(`${move.unitId} appears twice`);
    seen.add(move.unitId);
  }

  for (let i = 0; i < moves.length; i++) {
    const move = moves[i];
    const unit = units.find((u) => u.id === move.unitId);
    if (!unit) return fail(`unknown unit ${move.unitId}`);
    if (unit.side !== side) return fail(`${move.unitId} belongs to the other army`);
    if (unit.acted) return fail(`${move.unitId} already acted this turn`);

    // Movement legality against the state AS EVOLVED by all earlier entries.
    const pathError = isPathLegal(board, units, unit, move.path, cfg);
    if (pathError !== null) {
      // The standalone validator's message becomes the bundle-chain message for
      // the landing case; everything else (water, adjacency, length, enemy
      // entry, board edges) is already precise.
      if (pathError === "path ends on an occupied tile") {
        const [fx, fy] = move.path[move.path.length - 1];
        return fail(`tile (${fx},${fy}) is occupied in the current position of the turn chain`);
      }
      return fail(pathError);
    }
    const [fx, fy] = move.path[move.path.length - 1];

    // Claiming is exclusive: two entries to one tile still reject, flagged on
    // the earlier entry. (A tile held by any unit is already rejected above as
    // occupied-in-chain — including a unit that vacates it LATER in the bundle:
    // reorder, per the swap-by-order rule.)
    for (let j = i + 1; j < moves.length; j++) {
      const [lx, ly] = moves[j].path[moves[j].path.length - 1];
      if (lx === fx && ly === fy) return fail(`tile (${fx},${fy}) is claimed by two moves`);
    }

    // Loose shape on purpose: the engine must produce the catalogue messages
    // (`unknown action`, `attack requires a target`) for malformed input —
    // features/zod may not have seen it first.
    const action = move.action as { type?: string; targetId?: string };
    const cls = cfg.classes[unit.class];

    if (action.type === "attack") {
      if (!(cls.atk > 0)) return fail(`${unit.class} cannot attack`);
      if (typeof action.targetId !== "string" || action.targetId === "") {
        return fail("attack requires a target");
      }
      const target = units.find((u) => u.id === action.targetId);
      if (!target) {
        if (dead.has(action.targetId)) {
          return fail(`${action.targetId} is not a valid attack target`);
        }
        return fail(`unknown unit ${action.targetId}`);
      }
      if (target.side === unit.side) {
        return fail(`${action.targetId} is not a valid attack target`);
      }
      if (!new Set(cls.range).has(distance(fx, fy, target.x, target.y))) {
        return fail(
          `${unit.class} cannot attack a unit at ${distance(fx, fy, target.x, target.y)} tiles`,
        );
      }
    } else if (action.type === "heal") {
      if (cls.healAmount === undefined) return fail(`${unit.class} cannot heal`);
      if (typeof action.targetId !== "string" || action.targetId === "") {
        return fail("heal requires a target");
      }
      const target = units.find((u) => u.id === action.targetId);
      const healable =
        target !== undefined &&
        target.side === unit.side &&
        target.hp < target.maxHp &&
        distance(fx, fy, target.x, target.y) === 1;
      if (!healable) return fail("heal target must be adjacent and wounded");
    } else if (action.type !== "wait") {
      return fail(`unknown action "${String(action.type)}"`);
    }

    // ---- entry accepted: apply it fully before the next one begins ----
    const from: [number, number] = [unit.x, unit.y];
    unit.x = fx;
    unit.y = fy;
    if (move.path.length > 1) {
      events.push({ kind: "moved", unitId: unit.id, from, to: [fx, fy] });
    }

    if (action.type === "attack") {
      const target = units.find((u) => u.id === action.targetId)!;
      const targetCls = cfg.classes[target.class];
      const damage = Math.max(0, cls.atk - targetCls.def);
      target.hp -= damage;
      events.push({
        kind: "attack",
        attackerId: unit.id,
        targetId: target.id,
        damage,
        targetHp: target.hp,
      });
      if (target.hp <= 0) {
        units.splice(units.indexOf(target), 1);
        dead.add(target.id);
        events.push({ kind: "died", unitId: target.id });
      } else if (
        targetCls.atk > 0 &&
        new Set(targetCls.range).has(distance(unit.x, unit.y, target.x, target.y))
      ) {
        // Counter: the survived target answers iff the attacker's FINAL tile
        // lies within the target's own range. One counter per attack; it can kill.
        const counterDamage = Math.max(0, targetCls.atk - cls.def);
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
          dead.add(unit.id);
          events.push({ kind: "died", unitId: unit.id });
        }
      }
    } else if (action.type === "heal") {
      const target = units.find((u) => u.id === action.targetId)!;
      // healAmount is guaranteed defined by the validation guard above
      const healed = Math.min(cls.healAmount!, target.maxHp - target.hp);
      target.hp += healed;
      events.push({
        kind: "heal",
        healerId: unit.id,
        targetId: target.id,
        healed,
        targetHp: target.hp,
      });
    } else {
      // wait — legal anywhere, counts as acting
      events.push({ kind: "wait", unitId: unit.id });
    }

    unit.acted = true;
  }

  return { ok: true, result: { events, state: { board, units } } };
}
