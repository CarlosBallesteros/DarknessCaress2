import { isPathLegal } from "./reach.js";
import type { Board, GameEngineConfig, Move, Side, Unit } from "./types.js";

export interface AppliedTurn {
  events: Array<
    | { kind: "moved"; unitId: string; from: [number, number]; to: [number, number] }
    | { kind: "attack"; attackerId: string; targetId: string; damage: number; targetHp: number }
    | { kind: "counter"; attackerId: string; targetId: string; damage: number; targetHp: number } // targetId = the counterer
    | { kind: "heal"; healerId: string; targetId: string; healed: number; targetHp: number }
    | { kind: "died"; unitId: string }
    | { kind: "wait"; unitId: string }
  >;
  state: { board: Board; units: Unit[] }; // NEW state; caller persists it
}

function cloneState(state: { board: Board; units: Unit[] }): { board: Board; units: Unit[] } {
  return {
    board: { tiles: state.board.tiles.map((row) => [...row]) },
    units: state.units.map((u) => ({ ...u })),
  };
}

function findUnit(units: Unit[], id: string): Unit | undefined {
  return units.find((u) => u.id === id);
}

function removeDead(units: Unit[], id: string): void {
  const idx = units.findIndex((u) => u.id === id);
  if (idx !== -1) units.splice(idx, 1);
}

function manhattan(ax: number, ay: number, bx: number, by: number): number {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

export function applyMoves(
  state: { board: Board; units: Unit[] },
  moves: Move[],
  side: Side,
  cfg: GameEngineConfig,
): { ok: true; result: AppliedTurn } | { ok: false; error: string } {
  const working = cloneState(state);
  const events: AppliedTurn["events"] = [];
  const used = new Set<string>();
  const claimedFinals = new Set<string>(); // finals claimed by earlier non-wait entries

  for (const move of moves) {
    const unit = findUnit(working.units, move.unitId);
    if (!unit) return { ok: false, error: `unknown unit ${move.unitId}` };
    if (unit.side !== side) return { ok: false, error: `${move.unitId} belongs to the other army` };
    if (used.has(move.unitId)) return { ok: false, error: `${move.unitId} appears twice` };
    if (unit.acted) return { ok: false, error: `${move.unitId} already acted this turn` };

    const [fx, fy] = move.path[move.path.length - 1];
    const isWaitEntry = move.path.length === 1 && fx === unit.x && fy === unit.y;
    if (!isWaitEntry && claimedFinals.has(`${fx},${fy}`)) {
      return { ok: false, error: `tile (${fx},${fy}) is claimed by two moves` };
    }
    if (!isWaitEntry) {
      const destOcc = working.units.find((u) => u.x === fx && u.y === fy);
      if (destOcc) {
        return {
          ok: false,
          error: `tile (${fx},${fy}) is occupied in the current position of the turn chain`,
        };
      }
    }

    const pathErr = isPathLegal(working.board, working.units, unit, move.path, cfg);
    if (pathErr) return { ok: false, error: pathErr };

    // Landing rule (evolving), wait entries exempt - final emptiness/claims validated above.

    // Action validation against evolving state (positions after this move's teleport)
    const moverClass = cfg.classes[unit.class];
    const action = move.action as { type: string; targetId?: string };

    if (action.type === "attack") {
      if (!("targetId" in action) || action.targetId == null || action.targetId === "") {
        return { ok: false, error: "attack requires a target" };
      }
      if (moverClass.atk <= 0) {
        return { ok: false, error: `${unit.class} cannot attack` };
      }
      const target = findUnit(working.units, action.targetId);
      if (!target) return { ok: false, error: `unknown unit ${action.targetId}` };
      if (target.side === unit.side) {
        return { ok: false, error: `${action.targetId} is not a valid attack target` };
      }
      // alive in evolving state => present
      const dist = manhattan(fx, fy, target.x, target.y);
      if (!moverClass.range.includes(dist)) {
        return { ok: false, error: `${unit.class} cannot attack a unit at ${dist} tiles` };
      }
    } else if (action.type === "heal") {
      if (!("targetId" in action) || action.targetId == null || action.targetId === "") {
        return { ok: false, error: "heal requires a target" };
      }
      if (moverClass.healAmount === undefined) {
        return { ok: false, error: `${unit.class} cannot heal` };
      }
      if (unit.class !== "healer") {
        // only healer can heal per rules; healAmount present is healer in config, but be explicit
        return { ok: false, error: `${unit.class} cannot heal` };
      }
      const target = findUnit(working.units, action.targetId);
      if (!target) return { ok: false, error: `unknown unit ${action.targetId}` };
      if (target.side !== unit.side || target.hp >= target.maxHp) {
        return { ok: false, error: "heal target must be adjacent and wounded" };
      }
      const dist = manhattan(fx, fy, target.x, target.y);
      if (dist !== 1) {
        return { ok: false, error: "heal target must be adjacent and wounded" };
      }
    } else if (action.type === "wait") {
      // legal anywhere
    } else {
      return { ok: false, error: `unknown action "${action.type}"` };
    }

    // === Apply this entry fully (sequential) ===
    used.add(unit.id);
    const from: [number, number] = [unit.x, unit.y];
    const to: [number, number] = [fx, fy];

    // movement
    if (from[0] !== to[0] || from[1] !== to[1]) {
      unit.x = fx;
      unit.y = fy;
      events.push({ kind: "moved", unitId: unit.id, from, to });
    }
    // claim final tile for non-wait entries (exclusive)
    if (!isWaitEntry) {
      claimedFinals.add(`${fx},${fy}`);
    }

    if (action.type === "attack") {
      const target = findUnit(working.units, action.targetId as string)!;
      const targetClass = cfg.classes[target.class];
      const damage = Math.max(0, moverClass.atk - targetClass.def);
      target.hp -= damage;
      events.push({
        kind: "attack",
        attackerId: unit.id,
        targetId: target.id,
        damage,
        targetHp: target.hp,
      });
      if (target.hp <= 0) {
        events.push({ kind: "died", unitId: target.id });
        removeDead(working.units, target.id);
      } else {
        // counter if target survived and can attack and attacker final tile within target range from target tile
        const canCounter = targetClass.atk > 0 && unit.class !== "healer" ? true : true; // healer never counters - determined by target class
        // "the target's class can attack (atk > 0, archers/mages have their own range; healer never)"
        if (targetClass.atk > 0) {
          const counterDist = manhattan(target.x, target.y, unit.x, unit.y);
          if (targetClass.range.includes(counterDist)) {
            const counterDamage = Math.max(0, targetClass.atk - moverClass.def);
            unit.hp -= counterDamage;
            events.push({
              kind: "counter",
              attackerId: unit.id,
              targetId: target.id,
              damage: counterDamage,
              targetHp: unit.hp,
            });
            if (unit.hp <= 0) {
              events.push({ kind: "died", unitId: unit.id });
              removeDead(working.units, unit.id);
            }
          }
        }
        void canCounter;
      }
    } else if (action.type === "heal") {
      const target = findUnit(working.units, action.targetId as string)!;
      const healAmount = moverClass.healAmount ?? 0;
      const healed = Math.min(healAmount, target.maxHp - target.hp);
      target.hp += healed;
      events.push({
        kind: "heal",
        healerId: unit.id,
        targetId: target.id,
        healed,
        targetHp: target.hp,
      });
    } else if (action.type === "wait") {
      events.push({ kind: "wait", unitId: unit.id });
    }

    // mark acted for every unit that received an entry (wait counts), if still alive
    const actorNow = findUnit(working.units, unit.id);
    if (actorNow) {
      actorNow.acted = true;
    }
  }

  return { ok: true, result: { events, state: working } };
}

export function checkVictory(units: Unit[]): "player" | "enemy" | null {
  const playerAlive = units.some((u) => u.side === "player");
  const enemyAlive = units.some((u) => u.side === "enemy");
  if (!enemyAlive) return "player";
  if (!playerAlive) return "enemy";
  return null;
}
