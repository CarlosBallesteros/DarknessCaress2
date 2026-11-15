import type { Meta, Unit } from "../types";

export type Point = [number, number];

const DIRS: Point[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function key(x: number, y: number): string {
  return `${x},${y}`;
}

function inBounds(x: number, y: number, size: number): boolean {
  return x >= 0 && y >= 0 && x < size && y < size;
}

function isPassableTerrain(tile: string): boolean {
  return tile !== "lake" && tile !== "river";
}

export function manhattan(a: Point, b: Point): number {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
}

/**
 * Shortest path from start to destination over the preview's reachable tiles.
 * Movement is 4-neighborhood and constrained to start union moveTiles.
 */
export function shortestPath(start: Point, destination: Point, moveTiles: Point[]): Point[] | null {
  if (start[0] === destination[0] && start[1] === destination[1]) {
    return [start];
  }
  const allowed = new Set<string>([key(start[0], start[1])]);
  for (const [x, y] of moveTiles) allowed.add(key(x, y));
  if (!allowed.has(key(destination[0], destination[1]))) return null;

  const queue: Point[] = [start];
  const prev = new Map<string, Point | null>();
  prev.set(key(start[0], start[1]), null);

  for (let qi = 0; qi < queue.length; qi += 1) {
    const cur = queue[qi]!;
    for (const [dx, dy] of DIRS) {
      const nx = cur[0] + dx;
      const ny = cur[1] + dy;
      const k = key(nx, ny);
      if (!allowed.has(k) || prev.has(k)) continue;
      prev.set(k, cur);
      if (nx === destination[0] && ny === destination[1]) {
        const out: Point[] = [[nx, ny]];
        let p: Point | null = cur;
        while (p) {
          out.push(p);
          p = prev.get(key(p[0], p[1])) ?? null;
        }
        out.reverse();
        return out;
      }
      queue.push([nx, ny]);
    }
  }
  return null;
}

/**
 * Fallback pathfinding over passable terrain (non-water). Allows traversal through
 * any passable tile except those blocked (e.g. enemies, occupied claims as needed).
 * Used when reconstruction over moveTiles fails (e.g. pass-through intermediates).
 */
export function shortestPathOverPassable(
  boardTiles: string[][],
  boardSize: number,
  start: Point,
  destination: Point,
  blocked: Set<string>,
  maxSteps: number,
): Point[] | null {
  if (start[0] === destination[0] && start[1] === destination[1]) {
    return [start];
  }
  const startK = key(start[0], start[1]);
  const destK = key(destination[0], destination[1]);
  if (blocked.has(destK)) return null;

  const queue: Point[] = [start];
  const prev = new Map<string, Point | null>();
  const dist = new Map<string, number>();
  prev.set(startK, null);
  dist.set(startK, 0);

  for (let qi = 0; qi < queue.length; qi += 1) {
    const cur = queue[qi]!;
    const curK = key(cur[0], cur[1]);
    const d = dist.get(curK) ?? 0;
    if (d >= maxSteps) continue;
    for (const [dx, dy] of DIRS) {
      const nx = cur[0] + dx;
      const ny = cur[1] + dy;
      const nk = key(nx, ny);
      if (!inBounds(nx, ny, boardSize)) continue;
      if (prev.has(nk)) continue;
      const tile = boardTiles[ny]?.[nx] ?? "plain";
      if (!isPassableTerrain(tile)) continue;
      // can traverse unless blocked (e.g. enemy); destination blocked handled above
      if (blocked.has(nk) && nk !== destK) continue;
      prev.set(nk, cur);
      dist.set(nk, d + 1);
      if (nx === destination[0] && ny === destination[1]) {
        const out: Point[] = [[nx, ny]];
        let p: Point | null = cur;
        while (p) {
          out.push(p);
          p = prev.get(key(p[0], p[1])) ?? null;
        }
        out.reverse();
        return out;
      }
      queue.push([nx, ny]);
    }
  }
  return null;
}

export interface OccupancyState {
  // unit id -> current position considering staged ghosts
  positions: Map<string, Point>;
  // tiles claimed as final destinations by staged moves (blocked to land on)
  claimedDestinations: Set<string>;
}

/**
 * Build derived occupancy from authoritative units and staged move destinations.
 * Staged units are treated as settled ghosts at destination; their origins become vacant.
 */
export function buildOccupancy(
  units: Unit[],
  staged: Array<{ unitId: string; path: Point[] }>,
): OccupancyState {
  const positions = new Map<string, Point>();
  const claimedDestinations = new Set<string>();

  for (const u of units) {
    positions.set(u.id, [u.x, u.y]);
  }
  for (const s of staged) {
    const dest = s.path[s.path.length - 1];
    if (!dest) continue;
    positions.set(s.unitId, [dest[0], dest[1]]);
    claimedDestinations.add(key(dest[0], dest[1]));
  }
  return positions.size >= 0
    ? { positions, claimedDestinations }
    : { positions, claimedDestinations };
}

export function computeLocalMoveTiles(
  boardTiles: string[][],
  boardSize: number,
  units: Unit[],
  unitId: string,
  mov: number,
  staged: Array<{ unitId: string; path: Point[] }>,
): Point[] {
  const occ = buildOccupancy(units, staged);
  const unit = units.find((u) => u.id === unitId);
  if (!unit) return [];
  const start = occ.positions.get(unitId) ?? [unit.x, unit.y];

  // Build occupancy maps excluding the moving unit itself
  const enemyAt = new Set<string>();
  const allyAt = new Set<string>();
  for (const u of units) {
    if (u.id === unitId) continue;
    if (u.hp <= 0) continue;
    const pos = occ.positions.get(u.id) ?? [u.x, u.y];
    const k = key(pos[0], pos[1]);
    if (u.side === unit.side) allyAt.add(k);
    else enemyAt.add(k);
  }
  // Claimed destinations by other staged units are blocked to land on (and treated as occupied for landing)
  // but pass-through depends; simplest aligned rule: cannot end on claimed tile.
  const blockedLanding = new Set<string>([...enemyAt, ...allyAt, ...occ.claimedDestinations]);
  // remove our own claimed destination if somehow present (shouldn't be in staged set for this unit during reselect)
  blockedLanding.delete(key(start[0], start[1]));

  const dist = new Map<string, number>();
  const q: Point[] = [start];
  dist.set(key(start[0], start[1]), 0);
  const result: Point[] = [];

  for (let qi = 0; qi < q.length; qi += 1) {
    const [x, y] = q[qi]!;
    const d = dist.get(key(x, y)) ?? 0;
    if (d === mov) continue;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      const nk = key(nx, ny);
      if (!inBounds(nx, ny, boardSize)) continue;
      if (dist.has(nk)) continue;
      const tile = boardTiles[ny]?.[nx] ?? "plain";
      if (!isPassableTerrain(tile)) continue;
      if (enemyAt.has(nk)) continue; // enemies block movement
      // allies pass-through: can traverse, landing allowed only if not occupied/claimed
      dist.set(nk, d + 1);
      q.push([nx, ny]);
    }
  }

  for (const [k, d] of dist.entries()) {
    if (d === 0) continue;
    if (blockedLanding.has(k)) continue;
    const [sx, sy] = k.split(",").map(Number);
    if (Number.isFinite(sx) && Number.isFinite(sy)) result.push([sx, sy]);
  }

  // Include start tile as "stay" option contextually? moveTiles are destinations; start not usually listed,
  // but staying in place is possible via 1-entry path [own-tile] per spec - UI handles separately.
  return result.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}

export function filterAttackTilesFromDestination(
  destination: Point,
  attackTiles: Point[],
  range: number[],
): Point[] {
  const set = new Set(range);
  return attackTiles.filter((t) => set.has(manhattan(destination, t)));
}

export function unitMov(meta: Meta | null, unit: Unit | null): number {
  if (!meta || !unit) return 0;
  return meta.classes[unit.class]?.mov ?? 0;
}
