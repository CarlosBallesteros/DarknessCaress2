// Turn execution + victory (docs/02). Pure: validate the whole bundle entry by
// entry against a running copy of the state, apply strictly sequentially, and
// only hand back the NEW state on full success — a failing entry rejects the
// whole bundle and the caller's state is never touched (atomicity).
import { distance, isPathLegal, tileKey, unitAt } from "./reach";
import type { Board, GameEngineConfig, Move, Side, Unit } from "./types";

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
    | {
        kind: "counter";
        attackerId: string;
        targetId: string;
        damage: number;
        targetHp: number;
      } // targetId = the counterer
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

export function applyMoves(
  state: { board: Board; units: Unit[] },
  moves: Move[],
  side: Side,
  cfg: GameEngineConfig,
): { ok: true; result: AppliedTurn } | { ok: false; error: string } {
  // Deep copy up front: every entry validates and applies against this running
  // copy; it becomes the result only if the whole bundle succeeds.
  const board: Board = { tiles: state.board.tiles.map((row) => [...row]) };
  const units: Unit[] = state.units.map((u) => ({ ...u }));
  const byId = new Map(units.map((u) => [u.id, u]));
  const events: AppliedTurn["events"] = [];
  const used = new Set<string>(); // a unit may act at most once per bundle
  const claimed = new Set<string>(); // final tiles claimed by earlier entries (waiters claim nothing)

  for (const move of moves) {
    const error = validateAndApply(move, {
      side,
      cfg,
      board,
      units,
      byId,
      events,
      used,
      claimed,
    });
    if (error !== null) return { ok: false, error };
  }
  return { ok: true, result: { events, state: { board, units } } };
}

interface Running {
  side: Side;
  cfg: GameEngineConfig;
  board: Board;
  units: Unit[];
  byId: Map<string, Unit>;
  events: AppliedTurn["events"];
  used: Set<string>;
  claimed: Set<string>;
}

function validateAndApply(move: Move, run: Running): string | null {
  const { cfg, units, byId, events, used, claimed } = run;

  const actor = byId.get(move.unitId);
  if (!actor) return `unknown unit ${move.unitId}`;
  if (actor.side !== run.side)
    return `${move.unitId} belongs to the other army`;
  if (used.has(move.unitId)) return `${move.unitId} appears twice`;
  if (actor.acted) return `${move.unitId} already acted this turn`;

  const action = move.action as { type?: string; targetId?: unknown };
  if (
    action.type !== "attack" &&
    action.type !== "heal" &&
    action.type !== "wait"
  ) {
    return `unknown action "${String(action.type)}"`;
  }
  const stats = cfg.classes[actor.class];
  const canAttack = stats.atk > 0 && stats.range.length > 0;
  const canHeal = stats.healAmount !== undefined;
  if (
    (action.type === "attack" && !canAttack) ||
    (action.type === "heal" && !canHeal)
  ) {
    return `${actor.class} cannot ${action.type === "attack" ? "attack" : "heal"}`;
  }
  if (action.type !== "wait" && typeof action.targetId !== "string") {
    return `${action.type} requires a target`;
  }

  const path = move.path;
  const [finalX, finalY] = path[path.length - 1] ?? [-1, -1];
  const finalKey = tileKey(finalX, finalY);
  const landsElsewhere = finalX !== actor.x || finalY !== actor.y;
  // Landing rule, bundle-level (docs/02): wait entries are exempt (final tile =
  // own pre-move tile — nothing claimed, nothing needed); a tile claimed by an
  // earlier entry stays exclusive even if that claimer died to a counter.
  if (landsElsewhere) {
    if (claimed.has(finalKey))
      return `tile (${finalX},${finalY}) is claimed by two moves`;
    const occupant = unitAt(units, finalX, finalY);
    // An enemy on the final tile is a path-illegality case (isPathLegal below
    // names it precisely); only an ally standing there is a landing clash.
    if (occupant && occupant.side === actor.side) {
      return `tile (${finalX},${finalY}) is occupied in the current position of the turn chain`;
    }
  }

  // Path legality against the state AS EVOLVED by all earlier entries.
  const pathError = isPathLegal(run.board, units, actor, path, cfg);
  if (pathError !== null) return pathError;

  // Apply — strict sequential order: this entry completes fully (movement,
  // action, counter, death) before the next entry begins.
  const from: [number, number] = [actor.x, actor.y];
  if (landsElsewhere) {
    actor.x = finalX;
    actor.y = finalY;
    claimed.add(finalKey);
    events.push({
      kind: "moved",
      unitId: actor.id,
      from,
      to: [finalX, finalY],
    });
  }
  used.add(actor.id);
  actor.acted = true;

  if (action.type === "wait") {
    events.push({ kind: "wait", unitId: actor.id });
    return null;
  }
  const targetId = action.targetId as string;
  if (action.type === "heal") return applyHeal(actor, targetId, run);
  return applyAttack(actor, targetId, run);
}

function applyAttack(
  attacker: Unit,
  targetId: string,
  run: Running,
): string | null {
  const { cfg, units, byId, events } = run;
  const target = byId.get(targetId);
  if (!target) return `unknown unit ${targetId}`;
  if (target.side === attacker.side || target.hp <= 0) {
    return `${targetId} is not a valid attack target`;
  }
  const dist = distance(attacker.x, attacker.y, target.x, target.y);
  if (!cfg.classes[attacker.class].range.includes(dist)) {
    return `${attacker.class} cannot attack a unit at ${dist} tiles`;
  }

  const damage = Math.max(
    0,
    cfg.classes[attacker.class].atk - cfg.classes[target.class].def,
  );
  target.hp = Math.max(0, target.hp - damage); // hp ≤ 0 ⇒ dead ⇒ removed (floored at 0 for consumers)
  events.push({
    kind: "attack",
    attackerId: attacker.id,
    targetId: target.id,
    damage,
    targetHp: target.hp,
  });
  if (target.hp <= 0) {
    removeUnit(target, units, byId);
    events.push({ kind: "died", unitId: target.id });
    return null; // dead units never counter
  }

  // Counter (docs/02, exact rule): target alive, able to attack (atk > 0 with
  // its own range list — the healer never), and the ATTACKER'S FINAL TILE
  // within the TARGET'S range measured from the target's tile.
  const targetStats = cfg.classes[target.class];
  const counterRange = targetStats.range.includes(
    distance(target.x, target.y, attacker.x, attacker.y),
  );
  if (targetStats.atk > 0 && counterRange) {
    const back = Math.max(0, targetStats.atk - cfg.classes[attacker.class].def);
    attacker.hp = Math.max(0, attacker.hp - back);
    events.push({
      kind: "counter",
      attackerId: attacker.id,
      targetId: target.id,
      damage: back,
      targetHp: attacker.hp,
    });
    if (attacker.hp <= 0) {
      removeUnit(attacker, units, byId);
      events.push({ kind: "died", unitId: attacker.id });
    }
  }
  return null;
}

function applyHeal(
  healer: Unit,
  targetId: string,
  run: Running,
): string | null {
  const { cfg, events } = run;
  const target = run.byId.get(targetId);
  if (!target) return `unknown unit ${targetId}`;
  const adjacent = distance(healer.x, healer.y, target.x, target.y) === 1;
  if (target.side !== healer.side || !adjacent || target.hp >= target.maxHp) {
    return "heal target must be adjacent and wounded";
  }
  const healed = Math.min(
    cfg.classes[healer.class].healAmount as number,
    target.maxHp - target.hp,
  );
  target.hp += healed;
  events.push({
    kind: "heal",
    healerId: healer.id,
    targetId: target.id,
    healed,
    targetHp: target.hp,
  });
  return null;
}

function removeUnit(unit: Unit, units: Unit[], byId: Map<string, Unit>): void {
  const index = units.indexOf(unit);
  if (index >= 0) units.splice(index, 1);
  byId.delete(unit.id);
}

export function checkVictory(units: Unit[]): "player" | "enemy" | null {
  // "player" = enemy army wiped (player won). "enemy" = player army wiped.
  if (!units.some((u) => u.side === "enemy")) return "player";
  if (!units.some((u) => u.side === "player")) return "enemy";
  return null;
}
