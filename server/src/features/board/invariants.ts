// Hard gates over a materialized board (docs/03): a board is valid iff ALL
// hold. Invariants 1-3 apply only when the brief has a river; a riverless
// board skips to crossability. Returns null when valid, otherwise the failure
// reason (the retry policy's only signal).
import { config } from "../../config/load";
import type { Board, ClassKey, GameEngineConfig, Unit } from "../../game/types";
import type { Brief } from "./briefSchema";
import { SPAWN_BLOCK_COLUMNS, isReservedRow, spawnBlockStartColumn } from "./materialize";

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
        return `water tile (${x},${y}) in a reserved row`;
      }
    }
  }

  if (brief.river) {
    const pathFailure = validateRiverPath(tiles, size, brief);
    if (pathFailure) return pathFailure;
  } else {
    // Riverless brief: no water crossing may exist at all (zero river, zero
    // bridge) — the only water allowed is the lake.
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const tile = tiles[y][x];
        if (tile === "river" || tile === "bridge") {
          return `riverless brief produced a ${tile} tile at (${x},${y})`;
        }
      }
    }
  }

  // 4. Crossability: some walkable route connects the two spawn regions
  // (`bridge` counts; `rock` is walkable — only lake/river impassable, per
  // docs/02's movement rules).
  return crossable(tiles, size) ? null : "spawns are cut off from each other";
}

// 1+2+3 over river ∪ bridge tiles: one connected simple path spanning the
// left edge → right edge (each path tile has exactly 2 path neighbours except
// the two edge tiles, which have 1), never in reserved rows, bridge count
// equal to the brief's, every bridge on the path (part of the one component).
function validateRiverPath(tiles: Board["tiles"], size: number, brief: Brief): string | null {
  const isPathTile = (tile: string) => tile === "river" || tile === "bridge";
  const last = size - 1;

  const pathTiles: Array<[number, number]> = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (isPathTile(tiles[y][x])) pathTiles.push([x, y]);
    }
  }
  if (!pathTiles.some(([x]) => x === 0) || !pathTiles.some(([x]) => x === last)) {
    return "river does not span from the left edge to the right edge";
  }

  const neighbourCount = (x: number, y: number): number => {
    let count = 0;
    for (const [nx, ny] of [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ] as Array<[number, number]>) {
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      if (isPathTile(tiles[ny][nx])) count++;
    }
    return count;
  };

  for (const [x, y] of pathTiles) {
    const expected = x === 0 || x === last ? 1 : 2;
    if (neighbourCount(x, y) !== expected) {
      return `river path invariant broken at (${x},${y})`;
    }
    // 2. The river (as a path tile) never sits in a reserved row; overlap
    // with lake/rock is structurally impossible — a tile holds ONE type.
    if (isReservedRow(y, size)) {
      return `river path passes through reserved row ${y}`;
    }
  }

  // One connected component (counts alone could admit two disjoint paths).
  const seen = new Set<string>();
  const stack = [pathTiles[0]];
  while (stack.length > 0) {
    const [x, y] = stack.pop() as [number, number];
    const key = `${x},${y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const [nx, ny] of [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ] as Array<[number, number]>) {
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      if (isPathTile(tiles[ny][nx]) && !seen.has(`${nx},${ny}`)) {
        stack.push([nx, ny]);
      }
    }
  }
  if (seen.size !== pathTiles.length) {
    return "river path is not one connected simple path";
  }

  // 3. Bridge count equals the brief's; every bridge lies on the path (it is
  // a path tile of the one component by construction of the checks above).
  const bridges = pathTiles.filter(([x, y]) => tiles[y][x] === "bridge").length;
  if (bridges !== brief.bridgeTiles) {
    return `bridge count ${bridges} does not match the brief's ${brief.bridgeTiles}`;
  }
  return null;
}

// 4. BFS from the player's spawn block to the enemy's over walkable tiles.
function crossable(tiles: Board["tiles"], size: number): boolean {
  const isWater = (tile: string) => tile === "lake" || tile === "river";
  const startCol = spawnBlockStartColumn(size);
  const block = Array.from({ length: SPAWN_BLOCK_COLUMNS }, (_, i) => startCol + i);
  const enemyRows = [0, 1];
  const playerRows = [size - 2, size - 1];

  const visited = new Set<string>();
  const frontier: Array<[number, number]> = [];
  for (const y of playerRows) {
    for (const x of block) {
      if (isWater(tiles[y][x])) continue; // can't start from water
      visited.add(`${x},${y}`);
      frontier.push([x, y]);
    }
  }
  const enemyTargets = new Set<string>();
  for (const y of enemyRows) {
    for (const x of block) enemyTargets.add(`${x},${y}`);
  }

  while (frontier.length > 0) {
    const [x, y] = frontier.pop() as [number, number];
    if (enemyTargets.has(`${x},${y}`)) return true;
    for (const [nx, ny] of [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ] as Array<[number, number]>) {
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const key = `${nx},${ny}`;
      if (visited.has(key)) continue;
      if (isWater(tiles[ny][nx])) continue;
      visited.add(key);
      frontier.push([nx, ny]);
    }
  }
  return false;
}

// 5+6. Spawn slots: per side, the front row carries exactly the front group
// (2 swords, 2 axes, 1 spear at baseline — assembled from config counts),
// the back row the back group (remaining spear, archers, mage, healer — the
// healer NEVER front), 3 empty gaps per row, every unit standing on a plain
// reserved-row tile with fresh hp.
export function validateSpawn(board: Board, units: Unit[], cfg: GameEngineConfig): string | null {
  const size = cfg.boardSize;
  const startCol = spawnBlockStartColumn(size);
  const frontGroup = frontComposition(cfg);
  const backGroup = backComposition(cfg);

  if (units.length !== totalArmySize(cfg) * 2) {
    return `army has ${units.length} units, expected ${totalArmySize(cfg) * 2}`;
  }

  const seenIds = new Set<string>();
  for (const unit of units) {
    if (seenIds.has(unit.id)) return `duplicate unit id ${unit.id}`;
    seenIds.add(unit.id);
    if (!unit.id.startsWith(unit.side === "player" ? "P-" : "E-")) {
      return `unit id ${unit.id} does not match its side`;
    }
    const stats = cfg.classes[unit.class];
    if (unit.maxHp !== stats.hp || unit.hp !== unit.maxHp || unit.acted) {
      return `unit ${unit.id} is not freshly spawned`;
    }
    if (
      unit.x < startCol ||
      unit.x >= startCol + SPAWN_BLOCK_COLUMNS ||
      ![0, 1, size - 2, size - 1].includes(unit.y)
    ) {
      return `unit ${unit.id} spawned outside its 8x2 block`;
    }
    if (board.tiles[unit.y]?.[unit.x] !== "plain") {
      return `unit ${unit.id} spawned on an obstacle at (${unit.x},${unit.y})`;
    }
  }

  for (const side of ["player", "enemy"] as const) {
    const frontRow = side === "player" ? size - 2 : 1;
    const backRow = side === "player" ? size - 1 : 0;
    const sideUnits = units.filter((unit) => unit.side === side);
    const front = sideUnits.filter((unit) => unit.y === frontRow);
    const back = sideUnits.filter((unit) => unit.y === backRow);
    if (
      !sameMultiset(
        front.map((unit) => unit.class),
        frontGroup,
      )
    ) {
      return `${side} front row composition is wrong`;
    }
    if (
      !sameMultiset(
        back.map((unit) => unit.class),
        backGroup,
      )
    ) {
      return `${side} back row composition is wrong`;
    }
    // Row rule guarantees it, but the doc calls it out explicitly: the healer
    // NEVER sits front.
    if (front.some((unit) => unit.class === "healer")) {
      return `${side} healer sits in the front row`;
    }
  }
  return null;
}

// Front/back groups assembled from the CONFIG counts (docs/08 rule 3: never
// hardcoded) — baseline: front = 2 swords, 2 axes, 1 spear; back = remaining
// spear, 2 archers, mage, healer. The split rule: the attacker classes in
// display order fill the front row's 5 slots (docs/03: 5 front + 5 back per
// side), the overflow and all supporters go back.
const FRONT_ROW_UNITS = 5;

export function frontComposition(cfg: GameEngineConfig): ClassKey[] {
  const group: ClassKey[] = [];
  for (const key of ["sword", "axe", "spear"] as ClassKey[]) {
    for (let i = 0; i < cfg.classes[key].count && group.length < FRONT_ROW_UNITS; i++) {
      group.push(key);
    }
  }
  return group;
}

export function backComposition(cfg: GameEngineConfig): ClassKey[] {
  // The back row carries whatever the front row did NOT take — per-class
  // counts, not whole classes (the baseline spear splits 1 front / 1 back).
  const frontCounts = new Map<ClassKey, number>();
  for (const key of frontComposition(cfg)) {
    frontCounts.set(key, (frontCounts.get(key) ?? 0) + 1);
  }
  const group: ClassKey[] = [];
  for (const key of ["sword", "axe", "spear", "archer", "mage", "healer"] as ClassKey[]) {
    const remaining = cfg.classes[key].count - (frontCounts.get(key) ?? 0);
    for (let i = 0; i < remaining; i++) group.push(key);
  }
  return group;
}

export function totalArmySize(cfg: GameEngineConfig): number {
  return Object.values(cfg.classes).reduce((sum, c) => sum + c.count, 0);
}

function sameMultiset(actual: ClassKey[], expected: ClassKey[]): boolean {
  if (actual.length !== expected.length) return false;
  const sorted = (items: ClassKey[]) => [...items].sort();
  return sorted(actual).join() === sorted(expected).join();
}
