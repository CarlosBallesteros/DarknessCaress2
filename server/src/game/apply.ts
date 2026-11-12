import type { AppliedTurn, Board, GameEngineConfig, Move, Side, Unit } from "./types";
import { isPathLegal } from "./reach";

function cloneState(state: { board: Board; units: Unit[] }): { board: Board; units: Unit[] } {
  return {
    board: { tiles: state.board.tiles.map((row) => [...row]) },
    units: state.units.map((u) => ({ ...u })),
  };
}

function findUnit(units: Unit[], id: string): Unit | undefined {
  return units.find((u) => u.id === id);
}

function findUnitAt(units: Unit[], x: number, y: number): Unit | undefined {
  return units.find((u) => u.x === x && u.y === y);
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
  const seen = new Set<string>();
  const claimedFinals = new Set<string>();
  const planned: Array<{
    move: Move;
    unit: Unit;
    final: [number, number];
  }> = [];

  for (const move of moves) {
    const unit = findUnit(working.units, move.unitId);
    if (!unit) {
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

    const final = move.path[move.path.length - 1];
    const [fx, fy] = final;
    const isWaitEntry = move.path.length === 1 && fx === unit.x && fy === unit.y;

    if (!isWaitEntry) {
      const finalKey = `${fx},${fy}`;
      if (claimedFinals.has(finalKey)) {
        return { ok: false, error: `tile (${fx},${fy}) is claimed by two moves` };
      }
      const occupant = findUnitAt(working.units, fx, fy);
      if (occupant && occupant.id !== unit.id) {
        return {
          ok: false,
          error: `tile (${fx},${fy}) is occupied in the current position of the turn chain`,
        };
      }
    }

    const pathError = isPathLegal(working.board, working.units, unit, move.path, cfg);
    if (pathError) {
      if (pathError === "path ends on an occupied tile" && !isWaitEntry) {
        return {
          ok: false,
          error: `tile (${fx},${fy}) is occupied in the current position of the turn chain`,
        };
      }
      return { ok: false, error: pathError };
    }

    if (!isWaitEntry) {
      const finalKey = `${fx},${fy}`;
      if (claimedFinals.has(finalKey)) {
        return { ok: false, error: `tile (${fx},${fy}) is claimed by two moves` };
      }
      claimedFinals.add(finalKey);
      unit.x = fx;
      unit.y = fy;
    }

    planned.push({ move, unit, final });
  }

  const resultState = cloneState(state);
  const events: AppliedTurn["events"] = [];

  for (const { move } of planned) {
    const actor = findUnit(resultState.units, move.unitId);
    if (!actor || actor.hp <= 0) {
      continue;
    }
    const from: [number, number] = [actor.x, actor.y];
    const to = move.path[move.path.length - 1];
    const isWaitEntry = move.path.length === 1 && to[0] === from[0] && to[1] === from[1];

    actor.x = to[0];
    actor.y = to[1];
    if (!isWaitEntry) {
      events.push({ kind: "moved", unitId: actor.id, from, to });
    }

    const action = move.action;
    if (action.type === "wait") {
      events.push({ kind: "wait", unitId: actor.id });
    } else if (action.type === "attack") {
      if (!action.targetId) {
        return { ok: false, error: "attack requires a target" };
      }
      const attackerClass = cfg.classes[actor.class];
      if (attackerClass.atk <= 0) {
        return { ok: false, error: `${actor.class} cannot attack` };
      }
      const target = findUnit(resultState.units, action.targetId);
      if (!target || target.hp <= 0) {
        return { ok: false, error: `unknown unit ${action.targetId}` };
      }
      if (target.side === actor.side) {
        return { ok: false, error: `${action.targetId} is not a valid attack target` };
      }
      const dist = manhattan(actor.x, actor.y, target.x, target.y);
      if (!attackerClass.range.includes(dist)) {
        return { ok: false, error: `${actor.class} cannot attack a unit at ${dist} tiles` };
      }
      const damage = Math.max(0, attackerClass.atk - cfg.classes[target.class].def);
      target.hp -= damage;
      events.push({
        kind: "attack",
        attackerId: actor.id,
        targetId: target.id,
        damage,
        targetHp: target.hp,
      });
      if (target.hp <= 0) {
        events.push({ kind: "died", unitId: target.id });
        const idx = resultState.units.findIndex((u) => u.id === target.id);
        if (idx >= 0) resultState.units.splice(idx, 1);
      } else {
        const targetClass = cfg.classes[target.class];
        if (targetClass.atk > 0) {
          const cdist = manhattan(target.x, target.y, actor.x, actor.y);
          if (targetClass.range.includes(cdist)) {
            const cdamage = Math.max(0, targetClass.atk - attackerClass.def);
            actor.hp -= cdamage;
            events.push({
              kind: "counter",
              attackerId: target.id,
              targetId: actor.id,
              damage: cdamage,
              targetHp: actor.hp,
            });
            if (actor.hp <= 0) {
              events.push({ kind: "died", unitId: actor.id });
              const aidx = resultState.units.findIndex((u) => u.id === actor.id);
              if (aidx >= 0) resultState.units.splice(aidx, 1);
            }
          }
        }
      }
    } else if (action.type === "heal") {
      if (!action.targetId) {
        return { ok: false, error: "heal requires a target" };
      }
      if (actor.class !== "healer") {
        return { ok: false, error: `${actor.class} cannot heal` };
      }
      const target = findUnit(resultState.units, action.targetId);
      if (!target || target.hp <= 0) {
        return { ok: false, error: `unknown unit ${action.targetId}` };
      }
      const dist = manhattan(actor.x, actor.y, target.x, target.y);
      if (target.side !== actor.side || dist !== 1 || target.hp >= target.maxHp) {
        return { ok: false, error: "heal target must be adjacent and wounded" };
      }
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
      const unknown = (action as { type?: string }).type ?? "";
      return { ok: false, error: `unknown action "${unknown}"` };
    }

    const actorAfter = findUnit(resultState.units, actor.id);
    if (actorAfter) {
      actorAfter.acted = true;
    }
  }

  return { ok: true, result: { events, state: resultState } };
}

export function checkVictory(units: Unit[]): "player" | "enemy" | null {
  const playerAlive = units.some((u) => u.side === "player" && u.hp > 0);
  const enemyAlive = units.some((u) => u.side === "enemy" && u.hp > 0);
  if (!enemyAlive && playerAlive) return "player";
  if (!playerAlive && enemyAlive) return "enemy";
  return null;
}
