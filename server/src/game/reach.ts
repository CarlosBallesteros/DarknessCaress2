import type { Unit } from "./types.js";
import type { Board, ClassKey, GameEngineConfig } from "./types.js";

/** Manhattan distance — the only distance notion in the game (02: no diagonals). */
export function manhattan(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

function tileAt(board: Board, x: number, y: number): string | undefined {
  return board.tiles[y]?.[x];
}

/** "x,y" set key as returned by reachableTiles. */
export function tileKey(x: number, y: number): string {
  return `${x},${y}`;
}

/** Unit standing on a tile in the pre-move state, if any. */
function unitAt(units: Unit[], x: number, y: number): Unit | undefined {
  return units.find((u) => u.x === x && u.y === y);
}

function isWater(tile: string): boolean {
  // 02: lake/river are impassable; bridge is the only water crossing.
  return tile === "lake" || tile === "river";
}

function classStat(
  cfg: GameEngineConfig,
  unit: Unit,
): (typeof cfg.classes)[ClassKey] {
  return cfg.classes[unit.class];
}

/**
 * Every tile the unit can end its movement on this turn: BFS with a visited
 * set (all step costs equal 1, so BFS distance = optimal distance). Ally
 * tiles and the unit's own tile are passable but only the unit's own tile may
 * be ended on among occupied tiles.
 */
export function reachableTiles(
  board: Board,
  units: Unit[],
  unit: Unit,
  cfg: GameEngineConfig,
): Set<string> {
  const size = cfg.boardSize;
  const mov = classStat(cfg, unit).mov;
  const reachable = new Set<string>();
  // [x, y, distance]
  const frontier: Array<[number, number, number]> = [[unit.x, unit.y, 0]];
  const visited = new Set<string>([tileKey(unit.x, unit.y)]);
  while (frontier.length > 0) {
    const [x, y, distance] = frontier.shift() as [number, number, number];
    const occupant = unitAt(units, x, y);
    const isOwnTile = occupant !== undefined && occupant.id === unit.id;
    if (occupant === undefined || isOwnTile) {
      reachable.add(tileKey(x, y));
    }
    if (distance >= mov) {
      continue;
    }
    for (const [nx, ny] of [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ]) {
      if (nx < 0 || nx >= size || ny < 0 || ny >= size) {
        continue;
      }
      const key = tileKey(nx, ny);
      if (visited.has(key)) {
        continue;
      }
      const tile = tileAt(board, nx, ny);
      if (tile === undefined || isWater(tile)) {
        continue;
      }
      const occupant = unitAt(units, nx, ny);
      if (occupant !== undefined && occupant.side !== unit.side) {
        // enemy tiles block entirely — may not be entered at all
        continue;
      }
      visited.add(key);
      frontier.push([nx, ny, distance + 1]);
    }
  }
  return reachable;
}

/**
 * Validates one move's path against the pre-move state.
 * Returns null when legal, otherwise a precise user-facing rejection message.
 * A path's "length" is the number of EDGES stepped = path.length − 1.
 */
export function isPathLegal(
  board: Board,
  units: Unit[],
  unit: Unit,
  path: Array<[number, number]>,
  cfg: GameEngineConfig,
): string | null {
  const size = cfg.boardSize;
  const start = path[0];
  if (
    start === undefined ||
    manhattan(start[0], start[1], unit.x, unit.y) !== 0
  ) {
    return "path must start at the unit's tile";
  }
  const edges = path.length - 1;
  const mov = classStat(cfg, unit).mov;
  if (edges > mov) {
    return `path length ${edges} exceeds movement ${mov}`;
  }
  for (let i = 1; i < path.length; i++) {
    const [x, y] = path[i] as [number, number];
    const [px, py] = path[i - 1] as [number, number];
    if (manhattan(px, py, x, y) !== 1) {
      return `path step (${x},${y}) is not adjacent to the previous step`;
    }
    if (x < 0 || x >= size || y < 0 || y >= size) {
      return `path step (${x},${y}) is outside the board`;
    }
    const tile = tileAt(board, x, y);
    if (tile === undefined || isWater(tile)) {
      return `path step (${x},${y}) is water`;
    }
    const occupant = unitAt(units, x, y);
    if (occupant !== undefined && occupant.id !== unit.id) {
      if (occupant.side !== unit.side) {
        return `path enters an enemy unit at (${x},${y})`;
      }
      if (i === path.length - 1) {
        return "path ends on an occupied tile";
      }
    }
  }
  return null;
}

/**
 * The cosmetic move-preview overlay (02): moveTiles are the reachable final
 * tiles; attackTiles are enemy-occupied tiles whose unit stands at a Manhattan
 * distance present in the class's range LIST from some reachable final tile;
 * healTiles are wounded same-side units adjacent to some reachable final tile.
 */
export function previewMove(
  board: Board,
  units: Unit[],
  unit: Unit,
  cfg: GameEngineConfig,
): {
  moveTiles: Array<[number, number]>;
  attackTiles: Array<[number, number]>;
  healTiles: Array<[number, number]>;
} {
  const stat = classStat(cfg, unit);
  const reachable = reachableTiles(board, units, unit, cfg);
  const finals: Array<[number, number]> = [...reachable].map((key) => {
    const [x, y] = key.split(",");
    return [Number(x), Number(y)];
  });
  const attackTiles = new Map<string, [number, number]>();
  const healTiles: Array<[number, number]> = [];
  for (const other of units) {
    if (other.id === unit.id) {
      continue;
    }
    const tile: [number, number] = [other.x, other.y];
    if (other.side !== unit.side) {
      if (
        stat.range.some((distance) =>
          finals.some(
            ([fx, fy]) => manhattan(fx, fy, other.x, other.y) === distance,
          ),
        )
      ) {
        attackTiles.set(tileKey(other.x, other.y), tile);
      }
    } else if (stat.healAmount !== undefined && other.hp < other.maxHp) {
      if (
        finals.some(([fx, fy]) => manhattan(fx, fy, other.x, other.y) === 1)
      ) {
        healTiles.push(tile);
      }
    }
  }
  return {
    moveTiles: finals,
    attackTiles: [...attackTiles.values()],
    healTiles,
  };
}
