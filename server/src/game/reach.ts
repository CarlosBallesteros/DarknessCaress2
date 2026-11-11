import type { Board, GameEngineConfig, Unit } from "./types";

// Movement per docs/02: grid, 4-neighborhood, every step costs 1. Terrain never
// affects cost — water is the ONE mechanical exception (lake/river impassable,
// bridge walkable). BFS with a visited set is exact because all steps cost 1.

const WATER = new Set(["lake", "river"]);

export function tileKey(x: number, y: number): string {
  return `${x},${y}`;
}

export function parseTileKey(key: string): [number, number] {
  const comma = key.indexOf(",");
  return [Number(key.slice(0, comma)), Number(key.slice(comma + 1))];
}

export function tileAt(board: Board, x: number, y: number): string | undefined {
  return board.tiles[y]?.[x];
}

export function unitAt(units: Unit[], x: number, y: number): Unit | undefined {
  return units.find((u) => u.x === x && u.y === y);
}

function isInside(size: number, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < size && y < size;
}

function neighbors(x: number, y: number): Array<[number, number]> {
  return [
    [x + 1, y],
    [x - 1, y],
    [x, y + 1],
    [x, y - 1],
  ];
}

// Every tile the unit could end this turn's movement on: reachable by a legal
// path of ≤ mov edges. Ally-occupied tiles are passable but not standable; the
// unit's own tile counts as free while it moves (the Wait entry is legal).
export function reachableTiles(
  board: Board,
  units: Unit[],
  unit: Unit,
  cfg: GameEngineConfig,
): Set<string> {
  const size = cfg.boardSize;
  const reach = new Set<string>([tileKey(unit.x, unit.y)]);
  const visited = new Set<string>(reach);
  let frontier: Array<[number, number]> = [[unit.x, unit.y]];
  const mov = cfg.classes[unit.class].mov;

  for (let step = 0; step < mov; step++) {
    const next: Array<[number, number]> = [];
    for (const [x, y] of frontier) {
      for (const [nx, ny] of neighbors(x, y)) {
        if (!isInside(size, nx, ny)) continue;
        const key = tileKey(nx, ny);
        if (visited.has(key)) continue;
        const tile = tileAt(board, nx, ny);
        if (tile !== undefined && WATER.has(tile)) continue;
        const occupant = unitAt(units, nx, ny);
        if (occupant && occupant.side !== unit.side) continue; // enemy tiles cannot be entered
        visited.add(key);
        next.push([nx, ny]);
        if (!occupant) reach.add(key); // ally-occupied: passable through, not standable on
      }
    }
    frontier = next;
  }
  return reach;
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
  const [sx, sy] = path[0] ?? [NaN, NaN];
  if (sx !== unit.x || sy !== unit.y) return "path must start at the unit's tile";

  const size = cfg.boardSize;
  for (let i = 0; i < path.length; i++) {
    const [x, y] = path[i];
    if (!isInside(size, x, y)) return `path step (${x},${y}) is outside the board`;
    if (i > 0) {
      const [px, py] = path[i - 1];
      if (Math.abs(x - px) + Math.abs(y - py) !== 1) {
        return `path step (${x},${y}) is not adjacent to the previous step`;
      }
    }
    const tile = tileAt(board, x, y);
    if (tile !== undefined && WATER.has(tile)) return `path step (${x},${y}) is water`;
    const occupant = unitAt(units, x, y);
    if (occupant && occupant.side !== unit.side) {
      return `path enters an enemy unit at (${x},${y})`;
    }
  }

  const edges = path.length - 1;
  const mov = cfg.classes[unit.class].mov;
  if (edges > mov) return `path length ${edges} exceeds movement ${mov}`;

  const [fx, fy] = path[path.length - 1];
  const finalOccupant = unitAt(units, fx, fy);
  if (finalOccupant && finalOccupant.id !== unit.id) return "path ends on an occupied tile";
  return null;
}

// The preview overlay: every standable tile this turn, plus the enemy tiles
// attackable from any of them (range LIST membership, not ≤ max) and — for a
// class with a healAmount — the wounded same-side units healable this turn.
// Same source as validation, so the preview can never disagree with the engine.
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
  const reach = reachableTiles(board, units, unit, cfg);

  const moveTiles = [...reach].map(parseTileKey);

  const rangeSet = new Set(cfg.classes[unit.class].range);
  const attackTiles: Array<[number, number]> = [];
  const seenAttack = new Set<string>();
  for (const key of reach) {
    const [x, y] = parseTileKey(key);
    for (const enemy of units) {
      if (enemy.side === unit.side) continue;
      const targetKey = tileKey(enemy.x, enemy.y);
      if (seenAttack.has(targetKey)) continue;
      if (rangeSet.has(Math.abs(enemy.x - x) + Math.abs(enemy.y - y))) {
        seenAttack.add(targetKey);
        attackTiles.push([enemy.x, enemy.y]);
      }
    }
  }

  const healTiles: Array<[number, number]> = [];
  if (cfg.classes[unit.class].healAmount !== undefined) {
    const seenHeal = new Set<string>();
    for (const key of reach) {
      const [x, y] = parseTileKey(key);
      for (const ally of units) {
        if (ally.side !== unit.side) continue;
        if (ally.hp >= ally.maxHp) continue;
        const targetKey = tileKey(ally.x, ally.y);
        if (seenHeal.has(targetKey)) continue;
        if (Math.abs(ally.x - x) + Math.abs(ally.y - y) === 1) {
          seenHeal.add(targetKey);
          healTiles.push([ally.x, ally.y]);
        }
      }
    }
  }

  return { moveTiles, attackTiles, healTiles };
}
