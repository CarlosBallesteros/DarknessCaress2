// Hard gates over a materialized board (docs/03): a board is valid iff ALL
// hold. Invariants 1-3 apply only when the brief has a river; a riverless
// board skips to crossability. Returns null when valid, otherwise the failure
// reason (the retry policy's only signal).
import { config } from "../../config/load";
import type { Board, ClassKey, GameEngineConfig, Unit } from "../../game/types";
import type { Brief } from "./briefSchema";
import { isReservedRow, spawnBlockStartColumn, spawnBlockWidth } from "./materialize";

export function validateBoard(board: Board, brief: Brief): string | null {
  const size = config.boardSize;
  const tiles = board.tiles;
  if (tiles.length !== size || tiles.some((row) => row.length !== size)) {
    return `board is not ${size}x${size}`;
  }

  // 6a. No water tile (lake/river) remains in reserved rows.
  for (let y = 0; y < size; y++) {
    if (!isReservedRow(y, size)) continue;
    for (let x = 0; x < size; x++) {
      const tile = tiles[y][x];
      if (tile === "lake" || tile === "river") {
        return `water tile ${tile} in reserved row ${y}`;
      }
    }
  }

  if (brief.river !== null) {
    // 1. The river forms a single simple path from column 0 to column size-1
    // (bridge tiles included). Recorded at placement, so we verify by edges.
    const pathTiles: Array<[number, number]> = [];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const tile = tiles[y][x];
        if (tile === "river" || tile === "bridge") pathTiles.push([x, y]);
      }
    }
    if (pathTiles.length === 0) return "river brief produced no river tiles";
    const touchesLeft = pathTiles.some(([x]) => x === 0);
    const touchesRight = pathTiles.some(([x]) => x === size - 1);
    if (!touchsLeftEdge(touchesLeft) || !touchsRightEdge(touchesRight)) {
      return "river does not span left edge to right edge";
    }
    // Simple path: every path tile has 1 (endpoint) or 2 neighbors on the
    // path, and the whole set is connected.
    const pathSet = new Set(pathTiles.map(([x, y]) => `${x},${y}`));
    for (const [x, y] of pathTiles) {
      let neighbors = 0;
      for (const [dx, dy] of NEIGHBORS) {
        if (pathSet.has(`${x + dx},${y + dy}`)) neighbors++;
      }
      if (neighbors < 1 || neighbors > 2) {
        return "river is not a simple path";
      }
    }
    if (!connected(pathSet, pathTiles[0])) {
      return "river is not a single connected path";
    }

    // 2. Every bridge is a river tile at a straight horizontal segment with a
    // guaranteed escape (no water adjacent N/S, no obstacle adjacent N/S).
    // Tiles adjacent N/S of a bridge must remain walkable land — grass, hill,
    // or forest — never rock, river, or lake.
    let bridgeCount = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (tiles[y][x] !== "bridge") continue;
        bridgeCount++;
        if (x <= 0 || x >= size - 1) return "bridge on board edge";
        if (tiles[y][x - 1] !== "river" || tiles[y][x + 1] !== "river") {
          return "bridge is not on a straight horizontal segment";
        }
        if (!isWalkableLand(tiles[y - 1]?.[x]) || !isWalkableLand(tiles[y + 1]?.[x])) {
          return "bridge has no safe north/south escape";
        }
      }
    }

    // 3. Bridge count equals the brief's bridgeTiles.
    if (bridgeCount !== brief.bridgeTiles) {
      return `bridge count ${bridgeCount} does not match brief ${brief.bridgeTiles}`;
    }
  } else {
    // A riverless board has no river and no bridges (water beyond the lake).
    if (board.tiles.some((row) => row.some((t) => t === "river" || t === "bridge"))) {
      return "riverless brief produced river/bridge tiles";
    }
  }

  // 4. BFS from the player's spawn area to the enemy's over walkable tiles
  // (plain, forest, hill, bridge) finds a path — at least one bridge usable.
  if (!isCrossable(board)) return "no walkable path connects the spawn areas";

  return null;
}

const NEIGHBORS: ReadonlyArray<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function touchsLeftEdge(value: boolean): boolean {
  return value;
}
function touchsRightEdge(value: boolean): boolean {
  return value;
}

function isWalkableLand(tile: string | undefined): boolean {
  return tile === "plain" || tile === "forest" || tile === "hill";
}

function isWalkable(tile: string): boolean {
  return tile === "plain" || tile === "forest" || tile === "hill" || tile === "bridge";
}

function connected(pathSet: Set<string>, start: [number, number]): boolean {
  const queue: Array<[number, number]> = [start];
  const seen = new Set<string>([`${start[0]},${start[1]}`]);
  while (queue.length > 0) {
    const [x, y] = queue.shift() as [number, number];
    for (const [dx, dy] of NEIGHBORS) {
      const key = `${x + dx},${y + dy}`;
      if (!pathSet.has(key) || seen.has(key)) continue;
      seen.add(key);
      queue.push([x + dx, y + dy]);
    }
  }
  return seen.size === pathSet.size;
}

function isCrossable(board: Board): boolean {
  const size = board.tiles.length;
  const startCol = spawnBlockStartColumn(size);
  const width = spawnBlockWidth(size);
  const block = Array.from({ length: width }, (_, i) => startCol + i);
  const enemyFront = 1;
  const queue: Array<[number, number]> = [];
  const seen = new Set<string>();
  for (const x of block) {
    const key = `${x},${size - 2}`;
    if (isWalkable(board.tiles[size - 2][x]) && !seen.has(key)) {
      seen.add(key);
      queue.push([x, size - 2]);
    }
  }
  while (queue.length > 0) {
    const [x, y] = queue.shift() as [number, number];
    if (y === enemyFront && block.includes(x)) return true;
    for (const [dx, dy] of NEIGHBORS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const key = `${nx},${ny}`;
      if (seen.has(key) || !isWalkable(board.tiles[ny][nx])) continue;
      seen.add(key);
      queue.push([nx, ny]);
    }
  }
  return false;
}

// ── army composition helpers (consumed by spawn.ts and docs/03 invariant 5) ──
// Composition per docs/03: front = 2 swords, 2 axes, 1 spear; back = remaining
// spear, 2 archers, mage, healer. Spear is split across rows (1 front, rest back).
export const FRONT_ROW_CLASSES: readonly ClassKey[] = ["sword", "axe", "spear"];
export const BACK_ROW_CLASSES: readonly ClassKey[] = ["spear", "archer", "mage", "healer"];

export function totalArmySize(cfg: GameEngineConfig): number {
  return Object.values(cfg.classes).reduce((sum, entry) => sum + entry.count, 0);
}

export function frontComposition(cfg: GameEngineConfig): ClassKey[] {
  const out: ClassKey[] = [];
  // swords, axes: all to front; spear: 1 to front
  for (const cls of ["sword", "axe", "spear"] as const) {
    const count = cfg.classes[cls].count;
    const frontCount = cls === "spear" ? 1 : count;
    for (let i = 0; i < frontCount; i++) out.push(cls);
  }
  return out;
}

export function backComposition(cfg: GameEngineConfig): ClassKey[] {
  const out: ClassKey[] = [];
  // spear: remaining to back; others: all to back
  for (const cls of ["spear", "archer", "mage", "healer"] as const) {
    const count = cfg.classes[cls].count;
    const backCount = cls === "spear" ? Math.max(0, count - 1) : count;
    for (let i = 0; i < backCount; i++) out.push(cls);
  }
  return out;
}

// Invariant 5: spawn layout validity (checked once per pipeline run, since the
// armies don't depend on the brief).
export function validateSpawn(board: Board, units: Unit[], cfg: GameEngineConfig): string | null {
  const size = cfg.boardSize;
  const tiles = board.tiles;
  const expectedPerSide = totalArmySize(cfg);
  const startCol = spawnBlockStartColumn(size);
  const width = spawnBlockWidth(size);

  for (const side of ["player", "enemy"] as const) {
    const sideUnits = units.filter((unit) => unit.side === side);
    if (sideUnits.length !== expectedPerSide) {
      return `${side} army has ${sideUnits.length} units, expected ${expectedPerSide}`;
    }
    const frontRow = side === "player" ? size - 2 : 1;
    const backRow = side === "player" ? size - 1 : 0;
    const front = sideUnits.filter((u) => u.y === frontRow);
    const back = sideUnits.filter((u) => u.y === backRow);
    if (front.length + back.length !== expectedPerSide) {
      return `${side} units are not on the two spawn rows`;
    }
    const expectedFront = frontComposition(cfg).length;
    const expectedBack = backComposition(cfg).length;
    if (front.length !== expectedFront || back.length !== expectedBack) {
      return `${side} front/back counts do not match composition (${front.length}/${back.length} vs ${expectedFront}/${expectedBack})`;
    }
    // Class composition per row
    if (!sameMultiset(front.map((u) => u.class), frontComposition(cfg))) {
      return `${side} front row composition is invalid`;
    }
    if (!sameMultiset(back.map((u) => u.class), backComposition(cfg))) {
      return `${side} back row composition is invalid`;
    }
    for (const unit of sideUnits) {
      if (
        unit.x < startCol ||
        unit.x >= startCol + width ||
        (unit.y !== frontRow && unit.y !== backRow)
      ) {
        return `unit ${unit.id} spawned outside its spawn area`;
      }
      if (!isWalkable(tiles[unit.y][unit.x])) {
        return `unit ${unit.id} spawned on non-walkable tile ${tiles[unit.y][unit.x]}`;
      }
    }
  }
  return null;
}

function sameMultiset(actual: ClassKey[], expected: ClassKey[]): boolean {
  if (actual.length !== expected.length) return false;
  const counts = new Map<ClassKey, number>();
  for (const cls of actual) counts.set(cls, (counts.get(cls) ?? 0) + 1);
  for (const cls of expected) {
    const next = (counts.get(cls) ?? 0) - 1;
    if (next < 0) return false;
    counts.set(cls, next);
  }
  return true;
}
