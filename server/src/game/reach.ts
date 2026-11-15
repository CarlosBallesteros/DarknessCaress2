import type { Board, GameEngineConfig, Unit } from "./types.js";

const key = (x: number, y: number) => `${x},${y}`;

function inBounds(x: number, y: number, size: number): boolean {
  return x >= 0 && y >= 0 && x < size && y < size;
}

function isWater(board: Board, x: number, y: number): boolean {
  const tile = board.tiles[y]?.[x];
  return tile === "lake" || tile === "river";
}

function occupantAt(units: Unit[], x: number, y: number): Unit | undefined {
  return units.find((u) => u.x === x && u.y === y);
}

function isPassableStep(
  board: Board,
  units: Unit[],
  mover: Unit,
  x: number,
  y: number,
  cfg: GameEngineConfig,
): boolean {
  if (!inBounds(x, y, cfg.boardSize)) return false;
  if (isWater(board, x, y)) return false;
  const occ = occupantAt(units, x, y);
  if (!occ) return true;
  if (occ.id === mover.id) return true; // moving unit itself counts as free while it moves
  if (occ.side === mover.side) return true; // may pass through allies
  return false; // enemy blocks entry
}

function isStandableDest(
  board: Board,
  units: Unit[],
  mover: Unit,
  x: number,
  y: number,
  cfg: GameEngineConfig,
): boolean {
  if (!inBounds(x, y, cfg.boardSize)) return false;
  if (isWater(board, x, y)) return false;
  const occ = occupantAt(units, x, y);
  if (!occ) return true;
  return occ.id === mover.id; // only own origin allowed as "occupied" end (wait/self)
}

const DIRS: Array<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

interface Node {
  x: number;
  y: number;
  dist: number;
  prev: Node | null;
}

function bfs(board: Board, units: Unit[], unit: Unit, cfg: GameEngineConfig): Map<string, Node> {
  const start: Node = { x: unit.x, y: unit.y, dist: 0, prev: null };
  const visited = new Map<string, Node>();
  visited.set(key(start.x, start.y), start);
  const queue: Node[] = [start];
  const mov = cfg.classes[unit.class].mov;
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur.dist >= mov) continue;
    for (const [dx, dy] of DIRS) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      const k = key(nx, ny);
      if (visited.has(k)) continue;
      if (!isPassableStep(board, units, unit, nx, ny, cfg)) continue;
      const next: Node = { x: nx, y: ny, dist: cur.dist + 1, prev: cur };
      visited.set(k, next);
      queue.push(next);
    }
  }
  return visited;
}

export function reachableTiles(
  board: Board,
  units: Unit[],
  unit: Unit,
  cfg: GameEngineConfig,
): Set<string> {
  const visited = bfs(board, units, unit, cfg);
  const result = new Set<string>();
  for (const node of visited.values()) {
    if (isStandableDest(board, units, unit, node.x, node.y, cfg)) {
      result.add(key(node.x, node.y));
    }
  }
  return result;
}

export function isPathLegal(
  board: Board,
  units: Unit[],
  unit: Unit,
  path: [number, number][],
  cfg: GameEngineConfig,
): string | null {
  if (path.length === 0) return "path must start at the unit's tile";
  const [sx, sy] = path[0];
  if (sx !== unit.x || sy !== unit.y) return "path must start at the unit's tile";

  const mov = cfg.classes[unit.class].mov;
  const edges = path.length - 1;
  if (edges > mov) return `path length ${edges} exceeds movement ${mov}`;

  // step-by-step legality
  for (let i = 1; i < path.length; i++) {
    const [px, py] = path[i - 1];
    const [x, y] = path[i];
    if (!inBounds(x, y, cfg.boardSize)) {
      return `path step (${x},${y}) is outside the board`;
    }
    const man = Math.abs(x - px) + Math.abs(y - py);
    if (man !== 1) {
      return `path step (${x},${y}) is not adjacent to the previous step`;
    }
    if (isWater(board, x, y)) {
      return `path step (${x},${y}) is water`;
    }
    const occ = occupantAt(units, x, y);
    if (occ && occ.id !== unit.id) {
      if (occ.side !== unit.side) {
        return `path enters an enemy unit at (${x},${y})`;
      }
      // ally: pass-through allowed, but cannot end on occupied tile (checked below)
    }
  }

  const [ex, ey] = path[path.length - 1];
  const endOcc = occupantAt(units, ex, ey);
  if (endOcc && endOcc.id !== unit.id) {
    return "path ends on an occupied tile";
  }

  return null;
}

export function pathTo(
  board: Board,
  units: Unit[],
  unit: Unit,
  dest: [number, number],
  cfg: GameEngineConfig,
): Array<[number, number]> | null {
  const [dx, dy] = dest;
  if (!isStandableDest(board, units, unit, dx, dy, cfg)) return null;
  const visited = bfs(board, units, unit, cfg);
  const node = visited.get(key(dx, dy));
  if (!node) return null;
  // reconstruct origin -> dest inclusive
  const rev: Array<[number, number]> = [];
  let cur: Node | null = node;
  while (cur) {
    rev.push([cur.x, cur.y]);
    cur = cur.prev;
  }
  rev.reverse();
  return rev;
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

  if (cls.atk > 0 && cls.range.length > 0) {
    // enemy tiles at Manhattan distance ∈ class range list from any reachable final tile
    for (const enemy of units) {
      if (enemy.side === unit.side) continue;
      let can = false;
      for (const k of reachable) {
        const [xs, ys] = k.split(",");
        const rx = Number(xs);
        const ry = Number(ys);
        const dist = Math.abs(enemy.x - rx) + Math.abs(enemy.y - ry);
        if (cls.range.includes(dist)) {
          can = true;
          break;
        }
      }
      if (can) attackSet.add(key(enemy.x, enemy.y));
    }
  }

  if (cls.healAmount !== undefined) {
    // same-side units healable this turn: Manhattan-adjacent to any reachable final tile, hp < maxHp
    for (const ally of units) {
      if (ally.side !== unit.side) continue;
      if (ally.hp >= ally.maxHp) continue;
      let can = false;
      for (const k of reachable) {
        const [xs, ys] = k.split(",");
        const rx = Number(xs);
        const ry = Number(ys);
        const dist = Math.abs(ally.x - rx) + Math.abs(ally.y - ry);
        if (dist === 1) {
          can = true;
          break;
        }
      }
      if (can) healSet.add(key(ally.x, ally.y));
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
