import type { Board, GameEngineConfig, Unit } from "./types";

const DIRS: Array<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function key(x: number, y: number): string {
  return `${x},${y}`;
}

function inBounds(boardSize: number, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < boardSize && y < boardSize;
}

function isWalkableTile(tile: string): boolean {
  return tile !== "lake" && tile !== "river";
}

function unitAt(units: Unit[], x: number, y: number): Unit | undefined {
  return units.find((u) => u.x === x && u.y === y);
}

export function reachableTiles(
  board: Board,
  units: Unit[],
  unit: Unit,
  cfg: GameEngineConfig,
): Set<string> {
  const size = cfg.boardSize;
  const mov = cfg.classes[unit.class].mov;
  const visited = new Map<string, number>();
  const queue: Array<[number, number, number]> = [[unit.x, unit.y, 0]];
  visited.set(key(unit.x, unit.y), 0);

  while (queue.length > 0) {
    const [x, y, d] = queue.shift()!;
    if (d === mov) continue;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(size, nx, ny)) continue;
      const k = key(nx, ny);
      if (visited.has(k)) continue;
      const tile = board.tiles[ny]?.[nx];
      if (tile === undefined || !isWalkableTile(tile)) continue;
      const occ = unitAt(units, nx, ny);
      if (occ && occ.id !== unit.id && occ.side !== unit.side) continue; // enemy blocks entry
      // allies (and no one) can be entered/passed through; moving unit's own tile treated as free when relevant
      visited.set(k, d + 1);
      queue.push([nx, ny, d + 1]);
    }
  }

  const result = new Set<string>();
  for (const [k, d] of visited.entries()) {
    const [xs, ys] = k.split(",");
    const x = Number(xs);
    const y = Number(ys);
    const occ = unitAt(units, x, y);
    // cannot end on any occupied tile (moving unit's current tile is fine to stay on)
    if (occ && occ.id !== unit.id) continue;
    if (d <= mov) result.add(k);
  }
  // ensure start is included even if somehow missed
  result.add(key(unit.x, unit.y));
  return result;
}

export function isPathLegal(
  board: Board,
  units: Unit[],
  unit: Unit,
  path: [number, number][],
  cfg: GameEngineConfig,
): string | null {
  if (path.length === 0) {
    return "path must start at the unit's tile";
  }
  const [sx, sy] = path[0];
  if (sx !== unit.x || sy !== unit.y) {
    return "path must start at the unit's tile";
  }

  const size = cfg.boardSize;
  const mov = cfg.classes[unit.class].mov;
  const edges = path.length - 1;
  if (edges > mov) {
    return `path length ${edges} exceeds movement ${mov}`;
  }

  for (let i = 1; i < path.length; i++) {
    const [px, py] = path[i - 1];
    const [x, y] = path[i];
    const man = Math.abs(x - px) + Math.abs(y - py);
    if (man !== 1) {
      return `path step (${x},${y}) is not adjacent to the previous step`;
    }
    if (!inBounds(size, x, y)) {
      return `path step (${x},${y}) is outside the board`;
    }
    const tile = board.tiles[y]?.[x];
    if (tile === undefined || !isWalkableTile(tile)) {
      return `path step (${x},${y}) is water`;
    }
    const occ = unitAt(units, x, y);
    if (occ && occ.id !== unit.id && occ.side !== unit.side) {
      return `path enters an enemy unit at (${x},${y})`;
    }
  }

  const [ex, ey] = path[path.length - 1];
  const endOcc = unitAt(units, ex, ey);
  if (endOcc && endOcc.id !== unit.id) {
    return "path ends on an occupied tile";
  }

  return null;
}

function manhattan(ax: number, ay: number, bx: number, by: number): number {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

export function previewMove(
  board: Board,
  units: Unit[],
  unit: Unit,
  cfg: GameEngineConfig,
): {
  moveTiles: [number, number][];
  attackTiles: [number, number][];
  healTiles: [number, number][];
} {
  const reachable = reachableTiles(board, units, unit, cfg);
  const moveTiles: [number, number][] = [];
  for (const k of reachable) {
    const [xs, ys] = k.split(",");
    moveTiles.push([Number(xs), Number(ys)]);
  }

  const cls = cfg.classes[unit.class];
  const attackSet = new Set<string>();
  const healSet = new Set<string>();

  const rangeSet = new Set(cls.range);

  if (unit.class === "healer") {
    for (const k of reachable) {
      const [xs, ys] = k.split(",");
      const x = Number(xs);
      const y = Number(ys);
      for (const target of units) {
        if (target.side !== unit.side) continue;
        if (target.id === unit.id) continue;
        if (target.hp <= 0) continue;
        if (target.hp >= target.maxHp) continue;
        if (manhattan(x, y, target.x, target.y) === 1) {
          healSet.add(key(target.x, target.y));
        }
      }
    }
  } else if (cls.atk > 0 && cls.range.length > 0) {
    for (const k of reachable) {
      const [xs, ys] = k.split(",");
      const x = Number(xs);
      const y = Number(ys);
      for (const target of units) {
        if (target.side === unit.side) continue;
        if (target.hp <= 0) continue;
        const d = manhattan(x, y, target.x, target.y);
        if (rangeSet.has(d)) {
          attackSet.add(key(target.x, target.y));
        }
      }
    }
  }

  const attackTiles = Array.from(attackSet).map((k) => {
    const [xs, ys] = k.split(",");
    return [Number(xs), Number(ys)] as [number, number];
  });
  const healTiles = Array.from(healSet).map((k) => {
    const [xs, ys] = k.split(",");
    return [Number(xs), Number(ys)] as [number, number];
  });

  return { moveTiles, attackTiles, healTiles };
}

export function pathTo(
  board: Board,
  units: Unit[],
  unit: Unit,
  dest: [number, number],
  cfg: GameEngineConfig,
): Array<[number, number]> | null {
  const [dx, dy] = dest;
  const size = cfg.boardSize;
  if (!inBounds(size, dx, dy)) return null;
  // dest must be standable in given snapshot
  const endOcc = unitAt(units, dx, dy);
  if (endOcc && endOcc.id !== unit.id) return null;
  const tile = board.tiles[dy]?.[dx];
  if (tile === undefined || !isWalkableTile(tile)) return null;

  const mov = cfg.classes[unit.class].mov;
  const startKey = key(unit.x, unit.y);
  const prev = new Map<string, string | null>();
  const dist = new Map<string, number>();
  const queue: Array<[number, number]> = [[unit.x, unit.y]];
  prev.set(startKey, null);
  dist.set(startKey, 0);

  while (queue.length > 0) {
    const [x, y] = queue.shift()!;
    const d = dist.get(key(x, y))!;
    if (x === dx && y === dy) break;
    if (d === mov) continue;
    for (const [ox, oy] of DIRS) {
      const nx = x + ox;
      const ny = y + oy;
      if (!inBounds(size, nx, ny)) continue;
      const nk = key(nx, ny);
      if (prev.has(nk)) continue;
      const t = board.tiles[ny]?.[nx];
      if (t === undefined || !isWalkableTile(t)) continue;
      const occ = unitAt(units, nx, ny);
      if (occ && occ.id !== unit.id && occ.side !== unit.side) continue;
      prev.set(nk, key(x, y));
      dist.set(nk, d + 1);
      queue.push([nx, ny]);
    }
  }

  const destKey = key(dx, dy);
  if (!prev.has(destKey)) return null;
  const d = dist.get(destKey)!;
  if (d > mov) return null;

  const path: Array<[number, number]> = [];
  let cur: string | null = destKey;
  while (cur !== null) {
    const [xs, ys] = cur.split(",");
    path.push([Number(xs), Number(ys)]);
    cur = prev.get(cur) ?? null;
  }
  path.reverse();
  return path;
}
