import { isPathLegal } from "./reach";
import type { Board, GameEngineConfig, Move, Side, Unit } from "./types";

export interface AppliedTurn {
  events: Array<
    | { kind: "moved"; unitId: string; from: [number, number]; to: [number, number] }
    | { kind: "attack"; attackerId: string; targetId: string; damage: number; targetHp: number }
    | { kind: "counter"; attackerId: string; targetId: string; damage: number; targetHp: number }
    | { kind: "heal"; healerId: string; targetId: string; healed: number; targetHp: number }
    | { kind: "died"; unitId: string }
    | { kind: "wait"; unitId: string }
  >;
  state: { board: Board; units: Unit[] };
}

function cloneState(state: { board: Board; units: Unit[] }): {
  board: Board;
  units: Unit[];
} {
  return {
    board: { tiles: state.board.tiles.map((row) => [...row]) },
    units: state.units.map((u) => ({ ...u })),
  };
}

function unitIndexById(units: Unit[], id: string): number {
  return units.findIndex((u) => u.id === id);
}

function manhattan(ax: number, ay: number, bx: number, by: number): number {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

// (alive checks are inlined where needed)

function removeIfDead(units: Unit[], id: string, events: AppliedTurn["events"]): void {
  const idx = unitIndexById(units, id);
  if (idx === -1) return;
  if (units[idx].hp <= 0) {
    events.push({ kind: "died", unitId: id });
    units.splice(idx, 1);
  }
}

export function applyMoves(
  state: { board: Board; units: Unit[] },
  moves: Move[],
  side: Side,
  cfg: GameEngineConfig,
): { ok: true; result: AppliedTurn } | { ok: false; error: string } {
  const working = cloneState(state);
  const events: AppliedTurn["events"] = [];

  // Dry-run simulation on a cloned working state: validate+apply each entry sequentially.
  // Any failure rejects the whole bundle without touching the caller's state.
  const used = new Set<string>();
  const claimedFinals = new Set<string>();
  const tileKey = (x: number, y: number) => `${x},${y}`;

  for (const move of moves) {
    if (!move || typeof move.unitId !== "string") {
      return { ok: false, error: "unknown unit <id>" };
    }

    if (used.has(move.unitId)) {
      return { ok: false, error: `${move.unitId} appears twice` };
    }

    const actor = working.units.find((u) => u.id === move.unitId);
    if (!actor || actor.hp <= 0) {
      return { ok: false, error: `unknown unit ${move.unitId}` };
    }
    if (actor.side !== side) {
      return { ok: false, error: `${move.unitId} belongs to the other army` };
    }
    if (actor.acted) {
      return { ok: false, error: `${move.unitId} already acted this turn` };
    }

    if (!Array.isArray(move.path) || move.path.length === 0) {
      return { ok: false, error: "path must start at the unit's tile" };
    }

    const pathErr = isPathLegal(working.board, working.units, actor, move.path, cfg);
    if (pathErr) {
      // Refine landing-related path-end rejection to evolving/claiming messages when applicable.
      if (pathErr === "path ends on an occupied tile") {
        const [fx0, fy0] = move.path[move.path.length - 1];
        const fk0 = tileKey(fx0, fy0);
        const isWait0 = move.path.length === 1 && fx0 === actor.x && fy0 === actor.y;
        if (!isWait0) {
          if (claimedFinals.has(fk0)) {
            return { ok: false, error: `tile (${fx0},${fy0}) is claimed by two moves` };
          }
          return {
            ok: false,
            error: `tile (${fx0},${fy0}) is occupied in the current position of the turn chain`,
          };
        }
      }
      return { ok: false, error: pathErr };
    }

    const [fx, fy] = move.path[move.path.length - 1];
    const fk = tileKey(fx, fy);
    const isWaitEntry = move.path.length === 1 && fx === actor.x && fy === actor.y;

    if (!isWaitEntry) {
      if (claimedFinals.has(fk)) {
        return { ok: false, error: `tile (${fx},${fy}) is claimed by two moves` };
      }
      const endOcc = working.units.find((u) => u.x === fx && u.y === fy && u.id !== actor.id);
      if (endOcc) {
        return {
          ok: false,
          error: `tile (${fx},${fy}) is occupied in the current position of the turn chain`,
        };
      }
    }

    const action = move.action as { type?: string; targetId?: string } | undefined;
    if (!action || typeof action.type !== "string") {
      return { ok: false, error: 'unknown action "undefined"' };
    }
    if (action.type !== "attack" && action.type !== "heal" && action.type !== "wait") {
      return { ok: false, error: `unknown action "${action.type}"` };
    }

    if (action.type === "attack") {
      if (typeof action.targetId !== "string") {
        return { ok: false, error: "attack requires a target" };
      }
      if (actor.class === "healer" || cfg.classes[actor.class].atk <= 0) {
        return { ok: false, error: `${actor.class} cannot attack` };
      }
      const target = working.units.find((u) => u.id === action.targetId);
      if (!target) {
        return { ok: false, error: `unknown unit ${action.targetId}` };
      }
      if (target.hp <= 0 || target.side === actor.side) {
        return { ok: false, error: `${action.targetId} is not a valid attack target` };
      }
      const dist = manhattan(fx, fy, target.x, target.y);
      const rangeList = cfg.classes[actor.class].range;
      if (!rangeList.includes(dist)) {
        return { ok: false, error: `${actor.class} cannot attack a unit at ${dist} tiles` };
      }
    } else if (action.type === "heal") {
      if (typeof action.targetId !== "string") {
        return { ok: false, error: "heal requires a target" };
      }
      if (actor.class !== "healer") {
        return { ok: false, error: `${actor.class} cannot heal` };
      }
      const target = working.units.find((u) => u.id === action.targetId);
      if (!target) {
        return { ok: false, error: `unknown unit ${action.targetId}` };
      }
      const dist = manhattan(fx, fy, target.x, target.y);
      if (target.side !== actor.side || target.hp <= 0 || dist !== 1 || target.hp >= target.maxHp) {
        return { ok: false, error: "heal target must be adjacent and wounded" };
      }
    }

    // Apply this entry fully in sequence.
    const from: [number, number] = [actor.x, actor.y];
    if (fx !== actor.x || fy !== actor.y) {
      actor.x = fx;
      actor.y = fy;
      events.push({ kind: "moved", unitId: actor.id, from, to: [fx, fy] });
    }

    if (action.type === "attack") {
      const target = working.units.find((u) => u.id === action.targetId)!;
      const atk = cfg.classes[actor.class].atk;
      const damage = Math.max(0, atk - cfg.classes[target.class].def);
      target.hp -= damage;
      events.push({
        kind: "attack",
        attackerId: actor.id,
        targetId: target.id,
        damage,
        targetHp: target.hp,
      });
      if (target.hp <= 0) {
        removeIfDead(working.units, target.id, events);
      } else {
        const tCls = cfg.classes[target.class];
        if (
          tCls.atk > 0 &&
          tCls.range.length > 0 &&
          tCls.range.includes(manhattan(target.x, target.y, actor.x, actor.y))
        ) {
          const cDamage = Math.max(0, tCls.atk - cfg.classes[actor.class].def);
          actor.hp -= cDamage;
          events.push({
            kind: "counter",
            attackerId: target.id,
            targetId: actor.id,
            damage: cDamage,
            targetHp: actor.hp,
          });
          if (actor.hp <= 0) {
            removeIfDead(working.units, actor.id, events);
          }
        }
      }
    } else if (action.type === "heal") {
      const target = working.units.find((u) => u.id === action.targetId)!;
      const healAmount = cfg.classes.healer.healAmount ?? 0;
      const healed = Math.min(healAmount, target.maxHp - target.hp);
      target.hp += healed;
      events.push({
        kind: "heal",
        healerId: actor.id,
        targetId: target.id,
        healed,
        targetHp: target.hp,
      });
    } else {
      events.push({ kind: "wait", unitId: actor.id });
    }

    const actorAfter = working.units.find((u) => u.id === move.unitId);
    if (actorAfter) {
      actorAfter.acted = true;
    }

    if (!isWaitEntry) {
      claimedFinals.add(fk);
    }
    used.add(move.unitId);
  }

  return { ok: true, result: { events, state: working } };
}

export function checkVictory(units: Unit[]): "player" | "enemy" | null {
  const playerAlive = units.some((u) => u.side === "player" && u.hp > 0);
  const enemyAlive = units.some((u) => u.side === "enemy" && u.hp > 0);
  if (!enemyAlive) return "player";
  if (!playerAlive) return "enemy";
  return null;
}
