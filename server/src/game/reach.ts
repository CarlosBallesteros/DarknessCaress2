// Movement + previews (docs/02). Pure functions over {board, units} snapshots;
// every size/stat comes from GameEngineConfig — never from hardcoded numbers.
import type { Board, GameEngineConfig, Unit } from "./types";

export function tileKey(x: number, y: number): string {
  return `${x},${y}`;
}

export function distance(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

export function unitAt(units: Unit[], x: number, y: number): Unit | undefined {
  return units.find((u) => u.x === x && u.y === y);
}

function isWater(tile: Board["tiles"][number][number]): boolean {
  return tile === "lake" || tile === "river";
}

function inBounds(size: number, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < size && y < size;
}

function tileAt(board: Board, size: number, x: number, y: number) {
  if (!inBounds(size, x, y)) return undefined;
  return board.tiles[y]?.[x];
}

// Tiles the unit may legally END on this turn: every tile with a legal path of
// length ≤ mov. BFS expands through allies and the unit's own tile, never
// through water or enemy-occupied tiles; occupied tiles (allies) are reached
// but excluded from the result because a path may not END on them.
export function reachableTiles(
  board: Board,
  units: Unit[],
  unit: Unit,
  cfg: GameEngineConfig,
): Set<string> {
  const size = cfg.boardSize;
  const mov = cfg.classes[unit.class].mov;
  const start = tileKey(unit.x, unit.y);
  const reached = new Set<string>([start]);
  const frontier: Array<[number, number]> = [[unit.x, unit.y]];
  for (let steps = 0; steps < mov; steps++) {
    const next: Array<[number, number]> = [];
    for (const [x, y] of frontier) {
      for (const [nx, ny] of [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ] as Array<[number, number]>) {
        if (!inBounds(size, nx, ny)) continue;
        const key = tileKey(nx, ny);
        if (reached.has(key)) continue;
        const tile = tileAt(board, size, nx, ny);
        if (!tile || isWater(tile)) continue;
        const occupant = unitAt(units, nx, ny);
        if (occupant && occupant.side !== unit.side) continue; // enemies block entry
        reached.add(key);
        next.push([nx, ny]);
      }
    }
    frontier.length = 0;
    frontier.push(...next);
  }
  // End-legality filter: another unit standing there means no legal END there
  // (the mover's own tile counts as free — the docs' single ownership exception).
  for (const key of reached) {
    const [x, y] = key.split(",").map(Number) as [number, number];
    const occupant = unitAt(units, x, y);
    if (occupant && occupant.id !== unit.id) reached.delete(key);
  }
  return reached;
}

// null when legal, otherwise a precise rejection message (docs/02 catalogue).
// "path length" = the number of EDGES stepped = path.length − 1.
export function isPathLegal(
  board: Board,
  units: Unit[],
  unit: Unit,
  path: Array<[number, number]>,
  cfg: GameEngineConfig,
): string | null {
  const size = cfg.boardSize;
  const mov = cfg.classes[unit.class].mov;
  if (path.length === 0 || path[0][0] !== unit.x || path[0][1] !== unit.y) {
    return "path must start at the unit's tile";
  }
  const edges = path.length - 1;
  if (edges > mov) return `path length ${edges} exceeds movement ${mov}`;

  const [finalX, finalY] = path[path.length - 1];
  for (let i = 1; i < path.length; i++) {
    const [x, y] = path[i];
    const [px, py] = path[i - 1];
    if (!inBounds(size, x, y))
      return `path step (${x},${y}) is outside the board`;
    if (Math.abs(x - px) + Math.abs(y - py) !== 1) {
      return `path step (${x},${y}) is not adjacent to the previous step`;
    }
    const tile = tileAt(board, size, x, y);
    if (!tile) return `path step (${x},${y}) is outside the board`;
    if (isWater(tile)) return `path step (${x},${y}) is water`;
    const occupant = unitAt(units, x, y);
    if (occupant && occupant.id !== unit.id && occupant.side !== unit.side) {
      return `path enters an enemy unit at (${x},${y})`;
    }
  }

  const finalOccupant = unitAt(units, finalX, finalY);
  if (finalOccupant && finalOccupant.id !== unit.id) {
    return "path ends on an occupied tile";
  }
  return null;
}

export interface MovePreview {
  moveTiles: Array<[number, number]>;
  attackTiles: Array<[number, number]>; // enemy tiles at Manhattan distance ∈ the class's range LIST
  healTiles: Array<[number, number]>; // for healer: same-side units healable this turn
}

// Same source of truth as validation (docs/02): the preview is derived from
// reachableTiles so it can never disagree with what applyMoves accepts.
export function previewMove(
  board: Board,
  units: Unit[],
  unit: Unit,
  cfg: GameEngineConfig,
): MovePreview {
  const stats = cfg.classes[unit.class];
  const reachable = reachableTiles(board, units, unit, cfg);
  const moveTiles = [...reachable].map(
    (key) => key.split(",").map(Number) as [number, number],
  );

  const attackTiles = new Set<string>();
  const healTiles = new Set<string>();
  for (const [x, y] of moveTiles) {
    for (const other of units) {
      if (other.id === unit.id) continue;
      if (
        stats.range.includes(distance(x, y, other.x, other.y)) &&
        other.side !== unit.side
      ) {
        attackTiles.add(tileKey(other.x, other.y));
      }
      if (
        stats.healAmount !== undefined &&
        other.side === unit.side &&
        distance(x, y, other.x, other.y) === 1 &&
        other.hp < other.maxHp
      ) {
        healTiles.add(tileKey(other.x, other.y));
      }
    }
  }
  return {
    moveTiles,
    attackTiles: [...attackTiles].map(
      (key) => key.split(",").map(Number) as [number, number],
    ),
    healTiles: [...healTiles].map(
      (key) => key.split(",").map(Number) as [number, number],
    ),
  };
}
