import { previewMove } from "../../game/reach";
import type { Board, GameEngineConfig, Unit } from "../../game/types";

export type Difficulty = "aggressive" | "defensive" | "erratic";

export interface DestinationOrder {
  unitId: string;
  to?: [number, number];
  action:
    | { type: "attack"; targetId: string }
    | { type: "heal"; targetId: string }
    | { type: "wait" };
}

function key(x: number, y: number): string {
  return `${x},${y}`;
}

function manhattan(ax: number, ay: number, bx: number, by: number): number {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

function distToNearestPlayer(units: Unit[], x: number, y: number): number {
  let best = Infinity;
  for (const u of units) {
    if (u.side !== "player" || u.hp <= 0) continue;
    const d = manhattan(x, y, u.x, u.y);
    if (d < best) best = d;
  }
  return best;
}

function canAttackFrom(range: number[], x: number, y: number, target: Unit): boolean {
  return range.includes(manhattan(x, y, target.x, target.y));
}

function attackPairDestinations(
  reachable: [number, number][],
  range: number[],
  target: Unit,
): [number, number][] {
  const out: [number, number][] = [];
  for (const [x, y] of reachable) {
    if (canAttackFrom(range, x, y, target)) out.push([x, y]);
  }
  return out;
}

function healPairDestinations(reachable: [number, number][], ally: Unit): [number, number][] {
  const out: [number, number][] = [];
  for (const [x, y] of reachable) {
    if (manhattan(x, y, ally.x, ally.y) === 1) out.push([x, y]);
  }
  return out;
}

function comparePos(a: [number, number], b: [number, number]): number {
  if (a[1] !== b[1]) return a[1] - b[1];
  return a[0] - b[0];
}

function pickDeterministicTile(
  tiles: [number, number][],
  score: (t: [number, number]) => number,
  preferMin: boolean,
): [number, number] | undefined {
  if (tiles.length === 0) return undefined;
  let best = tiles[0];
  let bestScore = score(best);
  for (let i = 1; i < tiles.length; i++) {
    const t = tiles[i];
    const s = score(t);
    if (preferMin ? s < bestScore : s > bestScore) {
      best = t;
      bestScore = s;
    } else if (s === bestScore && comparePos(t, best) < 0) {
      best = t;
    }
  }
  return best;
}

function isTileClaimed(claimed: Set<string>, x: number, y: number): boolean {
  return claimed.has(key(x, y));
}

function filterUnclaimed(tiles: [number, number][], claimed: Set<string>): [number, number][] {
  return tiles.filter(([x, y]) => !isTileClaimed(claimed, x, y));
}

function chooseAggressive(
  board: Board,
  units: Unit[],
  unit: Unit,
  cfg: GameEngineConfig,
  claimed: Set<string>,
): DestinationOrder {
  const cls = cfg.classes[unit.class];
  const preview = previewMove(board, units, unit, cfg);
  const reachable = preview.moveTiles.filter(([x, y]) => !isTileClaimed(claimed, x, y));

  if (unit.class === "healer") {
    // prefer heal pairs for most wounded eligible ally
    let bestHeal: { ally: Unit; to: [number, number]; missing: number } | undefined;
    for (const maybe of units) {
      if (maybe.side !== "enemy" || maybe.id === unit.id || maybe.hp <= 0) continue;
      if (maybe.hp >= maybe.maxHp) continue;
      const tos = filterUnclaimed(healPairDestinations(reachable, maybe), claimed);
      if (tos.length === 0) continue;
      const to = pickDeterministicTile(tos, () => 0, true)!; // stable
      const missing = maybe.maxHp - maybe.hp;
      if (
        !bestHeal ||
        missing > bestHeal.missing ||
        (missing === bestHeal.missing && maybe.id < bestHeal.ally.id)
      ) {
        bestHeal = { ally: maybe, to, missing };
      }
    }
    if (bestHeal) {
      return {
        unitId: unit.id,
        to: bestHeal.to,
        action: { type: "heal", targetId: bestHeal.ally.id },
      };
    }
    // stay safe/back: pick reachable tile farthest from nearest player, preferring top rows
    const safeTo = pickDeterministicTile(
      reachable.length ? reachable : [[unit.x, unit.y]],
      (t) => distToNearestPlayer(units, t[0], t[1]) * 10 - t[1], // higher better: farther, and smaller y (back)
      false,
    )!;
    const to = safeTo[0] === unit.x && safeTo[1] === unit.y ? undefined : safeTo;
    return { unitId: unit.id, to, action: { type: "wait" } };
  }

  // attack-capable: find best attack pair
  if (cls.atk > 0 && cls.range.length > 0) {
    type Cand = { target: Unit; to: [number, number]; distToTarget: number };
    let best: Cand | undefined;
    for (const target of units) {
      if (target.side !== "player" || target.hp <= 0) continue;
      const tos = filterUnclaimed(attackPairDestinations(reachable, cls.range, target), claimed);
      if (tos.length === 0) continue;
      const to = pickDeterministicTile(
        tos,
        (t) => manhattan(t[0], t[1], target.x, target.y),
        true,
      )!;
      const dtt = manhattan(to[0], to[1], target.x, target.y);
      const cand: Cand = { target, to, distToTarget: dtt };
      if (!best) {
        best = cand;
        continue;
      }
      const aIsSupporter = cfg.classes[target.class].role === "supporter" ? 0 : 1;
      const bIsSupporter = cfg.classes[best.target.class].role === "supporter" ? 0 : 1;
      if (aIsSupporter !== bIsSupporter) {
        if (aIsSupporter < bIsSupporter) best = cand;
        continue;
      }
      if (target.hp !== best.target.hp) {
        if (target.hp < best.target.hp) best = cand;
        continue;
      }
      const aDistFromUnit = manhattan(unit.x, unit.y, target.x, target.y);
      const bDistFromUnit = manhattan(unit.x, unit.y, best.target.x, best.target.y);
      if (aDistFromUnit !== bDistFromUnit) {
        if (aDistFromUnit < bDistFromUnit) best = cand;
        continue;
      }
      if (dtt !== best.distToTarget) {
        if (dtt < best.distToTarget) best = cand;
        continue;
      }
      if (target.id < best.target.id) best = cand;
    }
    if (best) {
      const to = best.to[0] === unit.x && best.to[1] === unit.y ? undefined : best.to;
      return { unitId: unit.id, to, action: { type: "attack", targetId: best.target.id } };
    }
  }

  // advance toward nearest surviving player unit
  const advanceTo = pickDeterministicTile(
    reachable.length ? reachable : [[unit.x, unit.y]],
    (t) => distToNearestPlayer(units, t[0], t[1]),
    true,
  )!;
  const to = advanceTo[0] === unit.x && advanceTo[1] === unit.y ? undefined : advanceTo;
  return { unitId: unit.id, to, action: { type: "wait" } };
}

function chooseDefensive(
  board: Board,
  units: Unit[],
  unit: Unit,
  cfg: GameEngineConfig,
  claimed: Set<string>,
): DestinationOrder {
  const cls = cfg.classes[unit.class];
  const preview = previewMove(board, units, unit, cfg);
  const reachable = preview.moveTiles.filter(([x, y]) => !isTileClaimed(claimed, x, y));
  const currentThreat = distToNearestPlayer(units, unit.x, unit.y);

  if (unit.class === "healer") {
    // heal when pair exists, else keep back
    let bestHeal: { ally: Unit; to: [number, number]; missing: number } | undefined;
    for (const maybe of units) {
      if (maybe.side !== "enemy" || maybe.id === unit.id || maybe.hp <= 0) continue;
      if (maybe.hp >= maybe.maxHp) continue;
      const tos = filterUnclaimed(healPairDestinations(reachable, maybe), claimed);
      if (tos.length === 0) continue;
      // prefer safer to among heal options
      const to = pickDeterministicTile(
        tos,
        (t) => distToNearestPlayer(units, t[0], t[1]) * 10 - t[1],
        false,
      )!;
      const missing = maybe.maxHp - maybe.hp;
      if (
        !bestHeal ||
        missing > bestHeal.missing ||
        (missing === bestHeal.missing && maybe.id < bestHeal.ally.id)
      ) {
        bestHeal = { ally: maybe, to, missing };
      }
    }
    if (bestHeal) {
      return {
        unitId: unit.id,
        to: bestHeal.to,
        action: { type: "heal", targetId: bestHeal.ally.id },
      };
    }
    const safeTo = pickDeterministicTile(
      reachable.length ? reachable : [[unit.x, unit.y]],
      (t) => distToNearestPlayer(units, t[0], t[1]) * 10 - t[1],
      false,
    )!;
    const to = safeTo[0] === unit.x && safeTo[1] === unit.y ? undefined : safeTo;
    return { unitId: unit.id, to, action: { type: "wait" } };
  }

  // attack only when available without needlessly advancing forward into danger:
  // prefer attacking from a to no closer to nearest player than current position, when such pair exists
  if (cls.atk > 0 && cls.range.length > 0) {
    type Cand = { target: Unit; to: [number, number]; safe: boolean };
    const cands: Cand[] = [];
    for (const target of units) {
      if (target.side !== "player" || target.hp <= 0) continue;
      const tos = filterUnclaimed(attackPairDestinations(reachable, cls.range, target), claimed);
      for (const to of tos) {
        const threat = distToNearestPlayer(units, to[0], to[1]);
        cands.push({ target, to, safe: threat >= currentThreat });
      }
    }
    const safeCands = cands.filter((c) => c.safe);
    const pool = safeCands.length > 0 ? safeCands : [];
    if (pool.length > 0) {
      // pick best among safe: prefer supporter/low hp/closer target, but keep safe
      let best: Cand | undefined;
      for (const c of pool) {
        if (!best) {
          best = c;
          continue;
        }
        const aSup = cfg.classes[c.target.class].role === "supporter" ? 0 : 1;
        const bSup = cfg.classes[best.target.class].role === "supporter" ? 0 : 1;
        if (aSup !== bSup) {
          if (aSup < bSup) best = c;
          continue;
        }
        if (c.target.hp !== best.target.hp) {
          if (c.target.hp < best.target.hp) best = c;
          continue;
        }
        const ad = manhattan(unit.x, unit.y, c.target.x, c.target.y);
        const bd = manhattan(unit.x, unit.y, best.target.x, best.target.y);
        if (ad !== bd) {
          if (ad < bd) best = c;
          continue;
        }
        if (c.target.id < best.target.id) best = c;
      }
      if (best) {
        const to = best.to[0] === unit.x && best.to[1] === unit.y ? undefined : best.to;
        return { unitId: unit.id, to, action: { type: "attack", targetId: best.target.id } };
      }
    }
  }

  // hold ground behind own lines: maximize distance from nearest player while staying on/near spawn side (top rows)
  // prefer smaller y (back/top), and larger distance from nearest player
  const holdTo = pickDeterministicTile(
    reachable.length ? reachable : [[unit.x, unit.y]],
    (t) => distToNearestPlayer(units, t[0], t[1]) * 100 - t[1] * 10,
    false,
  )!;
  const to = holdTo[0] === unit.x && holdTo[1] === unit.y ? undefined : holdTo;
  return { unitId: unit.id, to, action: { type: "wait" } };
}

function chooseErratic(
  board: Board,
  units: Unit[],
  unit: Unit,
  cfg: GameEngineConfig,
  claimed: Set<string>,
  rng: () => number,
): DestinationOrder {
  const cls = cfg.classes[unit.class];
  const preview = previewMove(board, units, unit, cfg);
  const reachable = preview.moveTiles.filter(([x, y]) => !isTileClaimed(claimed, x, y));
  const options: DestinationOrder[] = [];

  if (unit.class === "healer") {
    for (const maybe of units) {
      if (maybe.side !== "enemy" || maybe.id === unit.id || maybe.hp <= 0) continue;
      if (maybe.hp >= maybe.maxHp) continue;
      const tos = filterUnclaimed(healPairDestinations(reachable, maybe), claimed);
      for (const to of tos) {
        options.push({ unitId: unit.id, to, action: { type: "heal", targetId: maybe.id } });
      }
    }
  } else if (cls.atk > 0 && cls.range.length > 0) {
    for (const target of units) {
      if (target.side !== "player" || target.hp <= 0) continue;
      const tos = filterUnclaimed(attackPairDestinations(reachable, cls.range, target), claimed);
      for (const to of tos) {
        options.push({ unitId: unit.id, to, action: { type: "attack", targetId: target.id } });
      }
    }
  }

  // move/wait options: any reachable tile (including stay)
  const moveTiles = reachable.length ? reachable : ([[unit.x, unit.y]] as [number, number][]);
  for (const to of moveTiles) {
    const t = to[0] === unit.x && to[1] === unit.y ? undefined : to;
    options.push({ unitId: unit.id, to: t, action: { type: "wait" } });
  }
  if (options.length === 0) {
    return { unitId: unit.id, action: { type: "wait" } };
  }
  const idx = Math.floor(rng() * options.length);
  return options[Math.min(idx, options.length - 1)];
}

export function chooseOrderForUnit(args: {
  board: Board;
  units: Unit[];
  unit: Unit;
  difficulty: Difficulty;
  cfg: GameEngineConfig;
  claimed: Set<string>;
  rng?: () => number;
}): DestinationOrder {
  const rng = args.rng ?? Math.random;
  if (args.difficulty === "aggressive") {
    return chooseAggressive(args.board, args.units, args.unit, args.cfg, args.claimed);
  }
  if (args.difficulty === "defensive") {
    return chooseDefensive(args.board, args.units, args.unit, args.cfg, args.claimed);
  }
  return chooseErratic(args.board, args.units, args.unit, args.cfg, args.claimed, rng);
}
