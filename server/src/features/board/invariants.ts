import type { Board, Tile } from "../../game/types.js";
import type { BoardBrief } from "./briefSchema.js";

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateBoard(
  board: Board,
  brief: BoardBrief,
  boardSize: number,
): ValidationResult {
  const errors: string[] = [];
  const tiles = board.tiles;
  const size = boardSize;

  if (brief.river) {
    validateRiver(tiles, brief, size, errors);
  }
  validateCrossability(tiles, size, errors);
  validateSpawns(tiles, size, errors);
  validateReserved(tiles, size, errors);

  return { ok: errors.length === 0, errors };
}

function inBounds(x: number, y: number, size: number): boolean {
  return x >= 0 && x < size && y >= 0 && y < size;
}

function isWater(t: Tile): boolean {
  return t === "river" || t === "lake";
}

function isWalkable(t: Tile): boolean {
  return t !== "lake" && t !== "river";
}

function riverish(t: Tile): boolean {
  return t === "river" || t === "bridge";
}

function neighbors4(x: number, y: number): Array<[number, number]> {
  return [
    [x + 1, y],
    [x - 1, y],
    [x, y + 1],
    [x, y - 1],
  ];
}

function validateRiver(tiles: Tile[][], brief: BoardBrief, size: number, errors: string[]): void {
  const riverCells: Array<[number, number]> = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (riverish(tiles[y]![x]!)) riverCells.push([x, y]);
    }
  }

  if (riverCells.length === 0) {
    errors.push("river missing");
    return;
  }

  // 2. River never passes through reserved rows; never overlaps lake/rock.
  for (const [, y] of riverCells) {
    if (y === 0 || y === 1 || y === size - 2 || y === size - 1) {
      errors.push("river passes through reserved row");
    }
  }

  // 1. One connected simple path spanning left edge → right edge
  const left = riverCells.filter(([x]) => x === 0);
  const right = riverCells.filter(([x]) => x === size - 1);
  if (left.length !== 1 || right.length !== 1) {
    errors.push("river must span left edge to right edge with single endpoints");
  }

  // connectivity
  const all = new Set(riverCells.map(([x, y]) => `${x},${y}`));
  const start = riverCells[0]!;
  const q: Array<[number, number]> = [start];
  const seen = new Set<string>([`${start[0]},${start[1]}`]);
  while (q.length) {
    const [cx, cy] = q.shift()!;
    for (const [nx, ny] of neighbors4(cx, cy)) {
      if (!inBounds(nx, ny, size)) continue;
      const k = `${nx},${ny}`;
      if (!all.has(k) || seen.has(k)) continue;
      seen.add(k);
      q.push([nx, ny]);
    }
  }
  if (seen.size !== all.size) {
    errors.push("river is not connected");
  }

  // degree/simple path
  for (const [x, y] of riverCells) {
    let deg = 0;
    for (const [nx, ny] of neighbors4(x, y)) {
      if (!inBounds(nx, ny, size)) continue;
      if (riverish(tiles[ny]![nx]!)) deg++;
    }
    const isEnd = x === 0 || x === size - 1;
    if (isEnd) {
      if (deg !== 1) errors.push("river endpoint degree invalid");
    } else {
      if (deg !== 2) errors.push("river path is not simple");
    }
  }

  // 3. Bridge count equals the brief's; every bridge lies on the river path.
  let bridges = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (tiles[y]![x] === "bridge") {
        bridges++;
        if (!all.has(`${x},${y}`)) {
          // bridge should be part of riverish set; by construction yes
        }
      }
    }
  }
  if (bridges !== brief.bridgeTiles) {
    errors.push(`bridge count ${bridges} != ${brief.bridgeTiles}`);
  }
}

function validateCrossability(tiles: Tile[][], size: number, errors: string[]): void {
  // BFS from the player's spawn area to the enemy's spawn area using walkable tiles (bridge counts)
  const startCells: Array<[number, number]> = [];
  for (const y of [size - 2, size - 1]) {
    for (let x = 0; x < size; x++) {
      if (isWalkable(tiles[y]![x]!)) startCells.push([x, y]);
    }
  }
  const targets = new Set<string>();
  for (const y of [0, 1]) {
    for (let x = 0; x < size; x++) {
      if (isWalkable(tiles[y]![x]!)) targets.add(`${x},${y}`);
    }
  }
  if (startCells.length === 0 || targets.size === 0) {
    errors.push("spawn areas not walkable");
    return;
  }

  const q: Array<[number, number]> = [...startCells];
  const seen = new Set<string>(startCells.map(([x, y]) => `${x},${y}`));
  let reached = false;
  while (q.length) {
    const [cx, cy] = q.shift()!;
    const ck = `${cx},${cy}`;
    if (targets.has(ck)) {
      reached = true;
      break;
    }
    for (const [nx, ny] of neighbors4(cx, cy)) {
      if (!inBounds(nx, ny, size)) continue;
      const nk = `${nx},${ny}`;
      if (seen.has(nk)) continue;
      if (!isWalkable(tiles[ny]![nx]!)) continue;
      seen.add(nk);
      q.push([nx, ny]);
    }
  }
  if (!reached) errors.push("board not crossable between spawn areas");
}

function validateSpawns(tiles: Tile[][], size: number, errors: string[]): void {
  // spawn tiles (reserved rows) must be walkable plain/terrain-safe and free of obstacles
  for (const y of [0, 1, size - 2, size - 1]) {
    for (let x = 0; x < size; x++) {
      const t = tiles[y]![x]!;
      if (t !== "plain" && t !== "forest" && t !== "hill" && t !== "rock" && t !== "bridge") {
        // bridge shouldn't appear in reserved rows but if it did it's walkable; water is not allowed
      }
      if (isWater(t)) errors.push("water in spawn row");
      // "obstacles" - rocks are cosmetic but tiles must be free of obstacles in spawn? doc says
      // "All spawn tiles must be walkable plain/terrain-safe and within the reserved spawn rows."
      // rock is a tile type; in practice reserved rows forced plain so fine.
      if (t === "rock") errors.push("obstacle in spawn row");
    }
  }
}

function validateReserved(tiles: Tile[][], size: number, errors: string[]): void {
  for (const y of [0, 1, size - 2, size - 1]) {
    for (let x = 0; x < size; x++) {
      const t = tiles[y]![x]!;
      if (t === "lake" || t === "river") {
        errors.push("water tile remains in reserved rows");
      }
    }
  }
}
