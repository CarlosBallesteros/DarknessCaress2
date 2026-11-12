import { config } from "../../config/load";
import { engineConfig } from "../../config/engine";
import { pathTo, previewMove } from "../../game/reach";
import type { Board, GameEngineConfig, Move, Unit } from "../../game/types";

export interface DestinationOrder {
  unitId: string;
  to?: [number, number]; // omitted = stay in place
  action:
    { type: "attack"; targetId: string } | { type: "heal"; targetId: string } | { type: "wait" };
}

interface AttackOption {
  targetId: string;
  target: Unit;
  to: [number, number];
}

interface HealOption {
  targetId: string;
  target: Unit;
  to: [number, number];
}

interface UnitOptions {
  attack: AttackOption[];
  heal: HealOption[];
  moves: [number, number][]; // reachable standable tiles (includes own tile)
}

function manhattan(ax: number, ay: number, bx: number, by: number): number {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

function keyOf(x: number, y: number): string {
  return `${x},${y}`;
}

function cloneUnits(units: Unit[]): Unit[] {
  return units.map((u) => ({ ...u }));
}

function enemyUnits(units: Unit[]): Unit[] {
  return units.filter((u) => u.side === "enemy").sort((a, b) => a.id.localeCompare(b.id));
}

function playerUnits(units: Unit[]): Unit[] {
  return units.filter((u) => u.side === "player");
}

function nearestPlayerDistance(x: number, y: number, players: Unit[]): number {
  if (players.length === 0) return 0;
  let best = Infinity;
  for (const p of players) {
    const d = manhattan(x, y, p.x, p.y);
    if (d < best) best = d;
  }
  return best;
}

function terrainPathDistances(board: Board, players: Unit[]): Map<string, number> {
  const size = board.tiles.length;
  const dist = new Map<string, number>();
  const queue: Array<[number, number]> = [];
  const water = new Set(["lake", "river"]);

  for (const p of players) {
    const k = keyOf(p.x, p.y);
    if (!dist.has(k)) {
      dist.set(k, 0);
      queue.push([p.x, p.y]);
    }
  }

  let head = 0;
  while (head < queue.length) {
    const [x, y] = queue[head++];
    const nd = dist.get(keyOf(x, y))! + 1;
    const deltas: Array<[number, number]> = [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ];
    for (const [nx, ny] of deltas) {
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const nk = keyOf(nx, ny);
      if (dist.has(nk)) continue;
      const tile = board.tiles[ny]?.[nx];
      if (tile !== undefined && water.has(tile)) continue;
      dist.set(nk, nd);
      queue.push([nx, ny]);
    }
  }
  return dist;
}

function computeOptions(
  board: Board,
  units: Unit[],
  unit: Unit,
  claimed: Set<string>,
  cfg: GameEngineConfig,
): UnitOptions {
  const { moveTiles, attackTiles, healTiles } = previewMove(board, units, unit, cfg);
  const rangeSet = new Set(config.classes[unit.class].range);
  const legalMoveTiles = moveTiles.filter(([x, y]) => !claimed.has(keyOf(x, y)));

  const unitAtTile = (tiles: Array<[number, number]>, side: "player" | "enemy"): Unit[] =>
    tiles
      .map(([x, y]) => units.find((u) => u.side === side && u.x === x && u.y === y))
      .filter((u): u is Unit => u !== undefined);

  const attack: AttackOption[] = [];
  for (const target of unitAtTile(attackTiles, "player")) {
    for (const [x, y] of legalMoveTiles) {
      if (x === target.x && y === target.y) continue;
      if (rangeSet.has(manhattan(target.x, target.y, x, y))) {
        attack.push({ targetId: target.id, target, to: [x, y] });
      }
    }
  }

  const heal: HealOption[] = [];
  if (config.classes[unit.class].healAmount !== undefined) {
    for (const ally of unitAtTile(healTiles, "enemy")) {
      for (const [x, y] of legalMoveTiles) {
        if (x === ally.x && y === ally.y) continue;
        if (manhattan(ally.x, ally.y, x, y) === 1) {
          heal.push({ targetId: ally.id, target: ally, to: [x, y] });
        }
      }
    }
  }

  return { attack, heal, moves: legalMoveTiles };
}

function pickAggressive(
  board: Board,
  planned: Unit[],
  unit: Unit,
  claimed: Set<string>,
): DestinationOrder {
  const opts = computeOptions(board, planned, unit, claimed, engineConfig);
  const players = playerUnits(planned);
  const cls = config.classes[unit.class];

  // Healer: prefer healing the most wounded eligible ally.
  if (cls.healAmount !== undefined) {
    if (opts.heal.length > 0) {
      const sorted = [...opts.heal].sort((a, b) => {
        const ahp = a.target.hp / a.target.maxHp;
        const bhp = b.target.hp / b.target.maxHp;
        if (ahp !== bhp) return ahp - bhp; // most wounded first
        if (a.target.id !== b.target.id) return a.target.id.localeCompare(b.target.id);
        return keyOf(a.to[0], a.to[1]).localeCompare(keyOf(b.to[0], b.to[1]));
      });
      const pick = sorted[0];
      return { unitId: unit.id, to: pick.to, action: { type: "heal", targetId: pick.targetId } };
    }
    // No heal: stay safe/back (maximize distance from nearest player, prefer staying on/near top)
    const move = pickSafestMove(unit, opts.moves, players, "aggressive-healer");
    return move
      ? { unitId: unit.id, to: move, action: { type: "wait" } }
      : { unitId: unit.id, action: { type: "wait" } };
  }

  if (opts.attack.length > 0) {
    const sorted = [...opts.attack].sort((a, b) => {
      const aSupport = config.classes[a.target.class].role === "supporter" ? 0 : 1;
      const bSupport = config.classes[b.target.class].role === "supporter" ? 0 : 1;
      if (aSupport !== bSupport) return aSupport - bSupport; // supporters first
      if (a.target.hp !== b.target.hp) return a.target.hp - b.target.hp; // lowest hp
      const da = manhattan(unit.x, unit.y, a.target.x, a.target.y);
      const db = manhattan(unit.x, unit.y, b.target.x, b.target.y);
      if (da !== db) return da - db; // closest to unit
      if (a.target.id !== b.target.id) return a.target.id.localeCompare(b.target.id);
      const dta = manhattan(a.to[0], a.to[1], a.target.x, a.target.y);
      const dtb = manhattan(b.to[0], b.to[1], b.target.x, b.target.y);
      if (dta !== dtb) return dta - dtb; // to that minimizes distance to target
      return keyOf(a.to[0], a.to[1]).localeCompare(keyOf(b.to[0], b.to[1]));
    });
    const pick = sorted[0];
    return { unitId: unit.id, to: pick.to, action: { type: "attack", targetId: pick.targetId } };
  }

  // No attack pairs: advance toward nearest surviving player unit.
  const move = pickAdvanceMove(board, unit, opts.moves, players);
  return move
    ? { unitId: unit.id, to: move, action: { type: "wait" } }
    : { unitId: unit.id, action: { type: "wait" } };
}

function pickDefensive(
  board: Board,
  planned: Unit[],
  unit: Unit,
  claimed: Set<string>,
): DestinationOrder {
  const opts = computeOptions(board, planned, unit, claimed, engineConfig);
  const players = playerUnits(planned);
  const cls = config.classes[unit.class];
  const currentDist = nearestPlayerDistance(unit.x, unit.y, players);

  // Healer: protect (stay back), heal when a pair exists.
  if (cls.healAmount !== undefined) {
    if (opts.heal.length > 0) {
      const sorted = [...opts.heal].sort((a, b) => {
        const ahp = a.target.hp / a.target.maxHp;
        const bhp = b.target.hp / b.target.maxHp;
        if (ahp !== bhp) return ahp - bhp;
        // prefer healing from a safer (farther from players) tile
        const ad = nearestPlayerDistance(a.to[0], a.to[1], players);
        const bd = nearestPlayerDistance(b.to[0], b.to[1], players);
        if (ad !== bd) return bd - ad;
        if (a.target.id !== b.target.id) return a.target.id.localeCompare(b.target.id);
        return keyOf(a.to[0], a.to[1]).localeCompare(keyOf(b.to[0], b.to[1]));
      });
      const pick = sorted[0];
      return { unitId: unit.id, to: pick.to, action: { type: "heal", targetId: pick.targetId } };
    }
    const move = pickSafestMove(unit, opts.moves, players, "defensive");
    return move
      ? { unitId: unit.id, to: move, action: { type: "wait" } }
      : { unitId: unit.id, action: { type: "wait" } };
  }

  // Attack only if available without needlessly advancing forward into danger:
  // prefer a pair whose `to` is no closer to nearest player than current position.
  if (opts.attack.length > 0) {
    const safeAttacks = opts.attack.filter(
      (a) => nearestPlayerDistance(a.to[0], a.to[1], players) >= currentDist,
    );
    const candidates = safeAttacks.length > 0 ? safeAttacks : [];
    if (candidates.length > 0) {
      const sorted = [...candidates].sort((a, b) => {
        const aSupport = config.classes[a.target.class].role === "supporter" ? 0 : 1;
        const bSupport = config.classes[b.target.class].role === "supporter" ? 0 : 1;
        if (aSupport !== bSupport) return aSupport - bSupport;
        if (a.target.hp !== b.target.hp) return a.target.hp - b.target.hp;
        const ad = nearestPlayerDistance(a.to[0], a.to[1], players);
        const bd = nearestPlayerDistance(b.to[0], b.to[1], players);
        if (ad !== bd) return bd - ad; // safer first
        if (a.target.id !== b.target.id) return a.target.id.localeCompare(b.target.id);
        return keyOf(a.to[0], a.to[1]).localeCompare(keyOf(b.to[0], b.to[1]));
      });
      const pick = sorted[0];
      return { unitId: unit.id, to: pick.to, action: { type: "attack", targetId: pick.targetId } };
    }
    // Has attacks but all require advancing into danger: hold/safe move instead.
  }

  const move = pickSafestMove(unit, opts.moves, players, "defensive");
  return move
    ? { unitId: unit.id, to: move, action: { type: "wait" } }
    : { unitId: unit.id, action: { type: "wait" } };
}

function pickErratic(
  board: Board,
  planned: Unit[],
  unit: Unit,
  claimed: Set<string>,
  rng: () => number,
): DestinationOrder {
  const opts = computeOptions(board, planned, unit, claimed, engineConfig);
  const choices: DestinationOrder[] = [];
  for (const a of opts.attack) {
    choices.push({ unitId: unit.id, to: a.to, action: { type: "attack", targetId: a.targetId } });
  }
  for (const h of opts.heal) {
    choices.push({ unitId: unit.id, to: h.to, action: { type: "heal", targetId: h.targetId } });
  }
  for (const m of opts.moves) {
    // move/wait: include moving to tile with wait action; staying put is also a wait
    if (m[0] === unit.x && m[1] === unit.y) {
      choices.push({ unitId: unit.id, action: { type: "wait" } });
    } else {
      choices.push({ unitId: unit.id, to: m, action: { type: "wait" } });
    }
  }
  if (choices.length === 0) return { unitId: unit.id, action: { type: "wait" } };
  const idx = Math.floor(rng() * choices.length);
  return choices[Math.min(idx, choices.length - 1)];
}

function pickAdvanceMove(
  board: Board,
  unit: Unit,
  moves: [number, number][],
  players: Unit[],
): [number, number] | undefined {
  if (moves.length === 0) return undefined;
  const dists = terrainPathDistances(board, players);
  const sorted = [...moves].sort((a, b) => {
    const da = dists.get(keyOf(a[0], a[1])) ?? nearestPlayerDistance(a[0], a[1], players) + 1000;
    const db = dists.get(keyOf(b[0], b[1])) ?? nearestPlayerDistance(b[0], b[1], players) + 1000;
    if (da !== db) return da - db; // closer to nearest player by walkable path (bridge-aware)
    // tie-break: prefer actually moving over staying if distances equal
    const aStay = a[0] === unit.x && a[1] === unit.y ? 1 : 0;
    const bStay = b[0] === unit.x && b[1] === unit.y ? 1 : 0;
    if (aStay !== bStay) return aStay - bStay;
    // secondary: straight-line progress
    const ma = nearestPlayerDistance(a[0], a[1], players);
    const mb = nearestPlayerDistance(b[0], b[1], players);
    if (ma !== mb) return ma - mb;
    return keyOf(a[0], a[1]).localeCompare(keyOf(b[0], b[1]));
  });
  return sorted[0];
}

function pickSafestMove(
  unit: Unit,
  moves: [number, number][],
  players: Unit[],
  mode: "defensive" | "aggressive-healer",
): [number, number] | undefined {
  if (moves.length === 0) return undefined;
  const sorted = [...moves].sort((a, b) => {
    const da = nearestPlayerDistance(a[0], a[1], players);
    const db = nearestPlayerDistance(b[0], b[1], players);
    if (da !== db) return db - da; // farther from players is safer
    if (mode === "defensive") {
      // hold spawn side / top rows: prefer smaller y (closer to enemy spawn)
      if (a[1] !== b[1]) return a[1] - b[1];
    } else {
      // aggressive healer: also prefer staying back (top)
      if (a[1] !== b[1]) return a[1] - b[1];
    }
    // prefer staying put over moving if equally safe
    const aStay = a[0] === unit.x && a[1] === unit.y ? 0 : 1;
    const bStay = b[0] === unit.x && b[1] === unit.y ? 0 : 1;
    if (aStay !== bStay) return aStay - bStay;
    return keyOf(a[0], a[1]).localeCompare(keyOf(b[0], b[1]));
  });
  return sorted[0];
}

export function computePolicyOrders(
  board: Board,
  units: Unit[],
  difficulty: string,
  rng: () => number = Math.random,
): DestinationOrder[] {
  const planned = cloneUnits(units);
  const claimed = new Set<string>();
  const orders: DestinationOrder[] = [];

  for (const original of enemyUnits(units)) {
    // use the planned copy's instance for this unit (position is original until we assign)
    const unit = planned.find((u) => u.id === original.id);
    if (unit === undefined) continue;

    let order: DestinationOrder;
    if (difficulty === "aggressive") {
      order = pickAggressive(board, planned, unit, claimed);
    } else if (difficulty === "defensive") {
      order = pickDefensive(board, planned, unit, claimed);
    } else if (difficulty === "erratic") {
      order = pickErratic(board, planned, unit, claimed, rng);
    } else {
      // unknown difficulty shouldn't happen (validated at creation), but be safe
      order = { unitId: unit.id, action: { type: "wait" } };
    }

    // Ensure chosen destination is not claimed and is legal in planned state; fallback to wait.
    const dest = order.to ?? ([unit.x, unit.y] as [number, number]);
    const destKey = keyOf(dest[0], dest[1]);
    if (claimed.has(destKey) || pathTo(board, planned, unit, dest, engineConfig) === null) {
      // try to find any unclaimed legal move (prefer stay)
      const { moveTiles } = previewMove(board, planned, unit, engineConfig);
      const fallback = [unit.x, unit.y] as [number, number];
      let chosen: [number, number] | undefined;
      // prefer stay-in-place if legal and unclaimed
      if (
        !claimed.has(keyOf(unit.x, unit.y)) &&
        pathTo(board, planned, unit, fallback, engineConfig) !== null
      ) {
        chosen = fallback;
      } else {
        chosen = moveTiles
          .map(([x, y]) => [x, y] as [number, number])
          .filter(([x, y]) => !claimed.has(keyOf(x, y)))
          .find(([x, y]) => pathTo(board, planned, unit, [x, y], engineConfig) !== null);
      }
      if (chosen !== undefined) {
        order = { unitId: unit.id, to: chosen, action: { type: "wait" } };
      } else {
        order = { unitId: unit.id, action: { type: "wait" } };
      }
    }

    const finalDest = order.to ?? ([unit.x, unit.y] as [number, number]);
    claimed.add(keyOf(finalDest[0], finalDest[1]));
    // update planned position so subsequent units see this unit at its destination
    unit.x = finalDest[0];
    unit.y = finalDest[1];

    // Simulate primary attack damage so later orders don't target a unit this
    // bundle will kill (applyMoves is sequential; a dead target can't be hit again).
    const action = order.action;
    if (action.type === "attack") {
      const targetIdx = planned.findIndex((u) => u.id === action.targetId && u.side === "player");
      if (targetIdx >= 0) {
        const attackerCls = config.classes[unit.class];
        const target = planned[targetIdx];
        const targetCls = config.classes[target.class];
        const damage = Math.max(0, attackerCls.atk - targetCls.def);
        target.hp -= damage;
        if (target.hp <= 0) {
          planned.splice(targetIdx, 1);
        }
      }
    }

    orders.push(order);
  }

  return orders;
}

// Expand destination-only orders into full engine Moves (same expansion aiTurn used),
// with defensive fallback to wait-in-place if expansion fails.
export function expandOrders(
  board: Board,
  units: Unit[],
  orders: DestinationOrder[],
  cfg: GameEngineConfig = engineConfig,
): Move[] {
  return orders.map((order) => {
    const unit = units.find((u) => u.side === "enemy" && u.id === order.unitId);
    if (unit === undefined) {
      // should not happen; skip-safe placeholder won't be produced in normal flow
      return { unitId: order.unitId, path: [[0, 0]], action: { type: "wait" } as const };
    }
    const dest = order.to ?? ([unit.x, unit.y] as [number, number]);
    const path = pathTo(board, units, unit, dest, cfg);
    if (path === null) {
      return { unitId: order.unitId, path: [[unit.x, unit.y]], action: { type: "wait" } as const };
    }
    // If action is attack/heal, ensure it's still plausible; otherwise degrade to wait.
    // (Policy should only emit legal pairs; this is a defensive guard.)
    const action = order.action;
    if (action.type === "attack") {
      const target = units.find((u) => u.id === action.targetId && u.side === "player");
      const cls = config.classes[unit.class];
      const inRange =
        target !== undefined && cls.range.includes(manhattan(dest[0], dest[1], target.x, target.y));
      if (!inRange) {
        return { unitId: order.unitId, path, action: { type: "wait" } as const };
      }
    } else if (action.type === "heal") {
      const target = units.find((u) => u.id === action.targetId && u.side === "enemy");
      const cls = config.classes[unit.class];
      const adjacent =
        target !== undefined && manhattan(dest[0], dest[1], target.x, target.y) === 1;
      if (cls.healAmount === undefined || !adjacent) {
        return { unitId: order.unitId, path, action: { type: "wait" } as const };
      }
    }
    return { unitId: order.unitId, path, action };
  });
}
