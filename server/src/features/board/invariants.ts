import type { Board, GameEngineConfig, Unit } from "../../game/types.js";
import type { Brief } from "./briefSchema.js";
import { spawnBlockStart } from "./spawn.js";

/**
 * The hard gates of 03: a materialized board with its spawned armies is valid
 * iff ALL invariants hold; any failure ⇒ retry. Invariants 1-3 apply only
 * when the brief has a river (a riverless board skips to invariant 4).
 * Returns null when valid, otherwise the reason (a debug aid — the retry
 * policy only needs the boolean).
 *
 * "River" in invariants 1-3 means the water path: river tiles plus the bridge
 * tiles lying on it. Lake-over-river or rock-over-river overlaps are
 * unrepresentable in the grid (one tile type per tile) — a future materializer
 * bug painting over the path surfaces as a degree/branch failure in
 * invariant 1 instead.
 */
export function checkInvariants(
  board: Board,
  brief: Brief,
  units: Unit[],
  cfg: GameEngineConfig,
): string | null {
  const size = cfg.boardSize;
  const reservedRows = new Set([0, 1, size - 2, size - 1]);
  const isWater = (tile: string): boolean =>
    tile === "river" || tile === "bridge";

  const waterTiles: Array<[number, number]> = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (isWater(board.tiles[y][x])) {
        waterTiles.push([x, y]);
      }
    }
  }

  if (brief.river) {
    // 1: one connected simple path spanning left edge → right edge; every
    // tile has exactly 2 water neighbors except the two edge tiles (1).
    const reason = checkRiverPath(waterTiles, size);
    if (reason !== null) {
      return reason;
    }
    // 2: the river never passes through reserved rows.
    if (waterTiles.some(([, y]) => reservedRows.has(y))) {
      return "river crosses a reserved row";
    }
    // 3: bridge count matches the brief; every bridge lies on the path.
    const bridges = waterTiles.filter(
      ([x, y]) => board.tiles[y][x] === "bridge",
    ).length;
    if (bridges !== brief.bridgeTiles) {
      return "bridge count does not match the brief";
    }
  }

  // 4: crossability — BFS from the player spawns to any enemy spawn over
  // walkable tiles (bridge counts as the only water crossing). On a riverless
  // board the lake/rocks may not wall a spawn side off either.
  const walkable = (x: number, y: number): boolean => {
    const tile = board.tiles[y]?.[x];
    return tile !== undefined && tile !== "lake" && tile !== "river";
  };
  const playerSpawns = units
    .filter((u) => u.side === "player")
    .map((u) => [u.x, u.y] as const);
  const enemySpawns = new Set(
    units.filter((u) => u.side === "enemy").map((u) => `${u.x},${u.y}`),
  );
  const seen = new Set(playerSpawns.map(([x, y]) => `${x},${y}`));
  const frontier = [...playerSpawns];
  let crossable = false;
  while (frontier.length > 0) {
    const [x, y] = frontier.pop() as [number, number];
    if (enemySpawns.has(`${x},${y}`)) {
      crossable = true;
      break;
    }
    for (const [nx, ny] of [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ]) {
      const key = `${nx},${ny}`;
      if (seen.has(key) || !walkable(nx, ny)) {
        continue;
      }
      seen.add(key);
      frontier.push([nx, ny]);
    }
  }
  if (!crossable) {
    return "no walkable path connects the two spawn sides";
  }

  // 5: spawn slots — per side, the 8×2 block holds the front group (swords,
  // axes, first spear) and the back group (remaining spear, archers, mage,
  // healer); the healer NEVER fronts; 3 empty gaps per row.
  const blockStart = spawnBlockStart(size);
  const blockEnd = blockStart + 7;
  for (const side of ["player", "enemy"] as const) {
    const frontRow = side === "player" ? size - 2 : 1;
    const backRow = side === "player" ? size - 1 : 0;
    const sideUnits = units.filter((u) => u.side === side);
    const front = sideUnits.filter((u) => u.y === frontRow);
    const back = sideUnits.filter((u) => u.y === backRow);
    const inBlock = sideUnits.every(
      (u) =>
        u.x >= blockStart &&
        u.x <= blockEnd &&
        (u.y === frontRow || u.y === backRow),
    );
    const distinctTiles = new Set(sideUnits.map((u) => `${u.x},${u.y}`)).size;
    const count = (list: Unit[], cls: string) =>
      list.filter((u) => u.class === cls).length;
    const gapsPerRow = 8 - front.length;
    if (!inBlock || distinctTiles !== sideUnits.length) {
      return "spawns outside the 8x2 block or stacked";
    }
    if (
      front.length !==
        count(sideUnits, "sword") + count(sideUnits, "axe") + 1 ||
      back.length !== sideUnits.length - front.length
    ) {
      return "spawn rows must hold the front/back groups of 03";
    }
    if (gapsPerRow !== 3) {
      return "spawn rows must leave 3 empty gaps";
    }
    if (front.some((u) => u.class === "healer")) {
      return "the healer never spawns front";
    }
    if (
      count(front, "spear") !== 1 ||
      count(back, "spear") !== count(sideUnits, "spear") - 1 ||
      count(front, "archer") !== 0 ||
      count(front, "mage") !== 0 ||
      count(front, "healer") !== 0 ||
      count(back, "sword") !== 0 ||
      count(back, "axe") !== 0
    ) {
      return "front/back row composition does not match 03";
    }
  }

  // 6: no water tile remains in reserved rows; spawn tiles are empty of
  // obstacles (obstacles = water + rock; forest/hill are walkable decoration).
  for (const y of reservedRows) {
    for (let x = 0; x < size; x++) {
      const tile = board.tiles[y][x];
      if (tile === "lake" || tile === "river") {
        return "water remains in a reserved row";
      }
    }
  }
  for (const unit of units) {
    const tile = board.tiles[unit.y][unit.x];
    if (tile === "lake" || tile === "river" || tile === "rock") {
      return "a spawn tile carries an obstacle";
    }
  }
  return null;
}

function checkRiverPath(
  waterTiles: Array<[number, number]>,
  size: number,
): string | null {
  const left = waterTiles.filter(([x]) => x === 0);
  const right = waterTiles.filter(([x]) => x === size - 1);
  if (left.length !== 1 || right.length !== 1) {
    return "the river must span the left and right edges exactly once";
  }
  const waterSet = new Set(waterTiles.map(([x, y]) => `${x},${y}`));
  const neighbors = (x: number, y: number): number =>
    [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ].filter(([nx, ny]) => waterSet.has(`${nx},${ny}`)).length;
  for (const [x, y] of waterTiles) {
    const expected = x === 0 || x === size - 1 ? 1 : 2;
    if (neighbors(x, y) !== expected) {
      return "the river is not one simple path";
    }
  }
  // Connectivity: from the left edge tile, the degree rule above plus a full
  // visit of the water set rules out branches and detached loops.
  const visited = new Set<string>([`${left[0]![0]},${left[0]![1]}`]);
  const frontier = [left[0] as [number, number]];
  while (frontier.length > 0) {
    const [x, y] = frontier.pop() as [number, number];
    for (const [nx, ny] of [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ]) {
      const key = `${nx},${ny}`;
      if (waterSet.has(key) && !visited.has(key)) {
        visited.add(key);
        frontier.push([nx, ny]);
      }
    }
  }
  if (visited.size !== waterTiles.length) {
    return "the river path is not fully connected";
  }
  return null;
}
