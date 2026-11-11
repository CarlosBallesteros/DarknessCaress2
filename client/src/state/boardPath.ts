import type { MoveSubmission, Unit, XY } from "../types/api";

export function manhattan(a: XY, b: XY): number {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
}

const key = (t: XY): string => `${t[0]},${t[1]}`;

const parse = (k: string): XY => {
  const [x, y] = k.split(",");
  return [Number(x), Number(y)];
};

// 05: the client computes + displays the shortest legal path via a tiny client
// BFS over the preview's reachable tiles — pure UX sugar that serializes the
// staged bundle's path; the server re-derives legality on submission (06 ep. 13).
//
// The preview's moveTiles are final-ELIGIBLE tiles only (empty or own tile —
// ally-occupied tiles are pass-through per 00 but are not in the served set).
// For routing, the graph is moveTiles ∪ passThrough (ally tiles), while the
// destination must be a moveTile. This mirrors the engine's own reach rule and
// keeps every produced path acceptable to the server's re-validation.
export function shortestPath(moveTiles: XY[], passThrough: XY[], from: XY, to: XY): XY[] | null {
  if (from[0] === to[0] && from[1] === to[1]) {
    return [from];
  }
  const passable = new Set([...moveTiles, ...passThrough].map(key));
  if (!passable.has(key(to)) || !moveTiles.some((t) => t[0] === to[0] && t[1] === to[1])) {
    return null;
  }
  const prev = new Map<string, string | null>([[key(from), null]]);
  const queue: XY[] = [from];
  while (queue.length > 0) {
    const cur = queue.shift() as XY;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const next: XY = [cur[0] + dx, cur[1] + dy];
      const nk = key(next);
      if (prev.has(nk) || !passable.has(nk)) {
        continue;
      }
      prev.set(nk, key(cur));
      if (next[0] === to[0] && next[1] === to[1]) {
        queue.length = 0;
        break;
      }
      queue.push(next);
    }
  }
  if (!prev.has(key(to))) {
    return null;
  }
  const path: XY[] = [];
  let cursor: string | null = key(to);
  while (cursor !== null) {
    path.unshift(parse(cursor));
    cursor = prev.get(cursor) ?? null;
  }
  return path;
}

export interface LocalPreviewInput {
  tiles: string[][]; // board grid, [y][x]
  boardSize: number; // from /api/meta — never hardcoded (08)
  mov: number; // the mover's class mov from /api/meta
  range: number[]; // the mover's class range list from /api/meta
  canHeal: boolean; // healAmount present in /api/meta (healer)
  units: Unit[]; // authoritative pre-move state (06 conventions)
  unitId: string; // the unit whose preview is wanted (never staged itself)
  staged: MoveSubmission[]; // already-staged bundles, in submission order
}

export interface LocalPreview {
  moveTiles: XY[];
  attackTiles: XY[];
  healTiles: XY[];
}

// 05, "Movement preview & ghost staging": while moves are staged, SUBSEQUENT
// selections recompute the reachable set CLIENT-SIDE with the staged positions
// applied — each staged unit settles as a ghost on its destination, its origin
// becomes legitimately landable (chain-following is legal per 02), and the
// ghost's destination stays blocked. The bundle is applied entry-by-entry in
// submission order, mirroring the engine's evolving state; the server
// re-validates the whole bundle on submission either way.
//
// Same rules as the engine's own reach (02/06): movement steps ≤ mov, water
// impassable outside bridges, enemies block passage, allies pass through but a
// path may not END on an occupied tile (the mover's own tile is the single
// ownership exception).
export function localPreview(input: LocalPreviewInput): LocalPreview {
  const { tiles, boardSize, mov, range, canHeal, units, unitId, staged } = input;
  const mover = units.find((u) => u.id === unitId);
  if (mover === undefined) {
    return { moveTiles: [], attackTiles: [], healTiles: [] };
  }

  // Derived occupancy: apply the staged bundle entry-by-entry, in order —
  // each entry lifts its unit from its origin and settles it on the path's
  // final tile (the ghost).
  const occupancy = new Map<string, Unit>();
  for (const unit of units) {
    occupancy.set(key([unit.x, unit.y]), unit);
  }
  for (const move of staged) {
    const actor = units.find((u) => u.id === move.unitId);
    if (actor === undefined || move.path.length === 0) {
      continue;
    }
    occupancy.delete(key([actor.x, actor.y]));
    const [gx, gy] = move.path[move.path.length - 1];
    occupancy.set(key([gx, gy]), { ...actor, x: gx, y: gy });
  }

  const isWater = (x: number, y: number): boolean => {
    const tile = tiles[y]?.[x];
    return tile === "lake" || tile === "river";
  };

  // BFS over the derived occupancy: enemies (never staged) block passage;
  // allies — ghosts included — pass through but cannot be landed on.
  const reached = new Set<string>([key([mover.x, mover.y])]);
  let frontier: XY[] = [[mover.x, mover.y]];
  for (let steps = 0; steps < Math.max(0, mov); steps++) {
    const next: XY[] = [];
    for (const [x, y] of frontier) {
      for (const [nx, ny] of [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ]) {
        if (nx < 0 || ny < 0 || nx >= boardSize || ny >= boardSize) {
          continue;
        }
        const nk = key([nx, ny]);
        if (reached.has(nk) || isWater(nx, ny)) {
          continue;
        }
        const occupant = occupancy.get(nk);
        if (occupant !== undefined && occupant.side !== mover.side) {
          continue; // enemies block entry (00)
        }
        reached.add(nk);
        next.push([nx, ny]);
      }
    }
    frontier = next;
  }
  // End-legality: another unit standing there (ghost or not) means no legal
  // END there — the mover's own tile is the ownership exception (02).
  const moveTiles: XY[] = [];
  for (const k of reached) {
    const occupant = occupancy.get(k);
    if (occupant === undefined || occupant.id === mover.id) {
      moveTiles.push(parse(k));
    }
  }

  // Attack/heal sets from the SAME pure arithmetic the engine uses (06 ep. 12):
  // enemy tiles at Manhattan distance ∈ the class's range list from SOME
  // reachable tile; healer allies wounded at Manhattan 1.
  const attackTiles: XY[] = [];
  const healTiles: XY[] = [];
  for (const unit of occupancy.values()) {
    if (unit.id === mover.id) {
      continue;
    }
    if (unit.side !== mover.side && range.length > 0) {
      if (moveTiles.some((t) => range.includes(manhattan(t, [unit.x, unit.y])))) {
        attackTiles.push([unit.x, unit.y]);
      }
    }
    if (canHeal && unit.side === mover.side && unit.hp < unit.maxHp) {
      if (moveTiles.some((t) => manhattan(t, [unit.x, unit.y]) === 1)) {
        healTiles.push([unit.x, unit.y]);
      }
    }
  }
  return { moveTiles, attackTiles, healTiles };
}
