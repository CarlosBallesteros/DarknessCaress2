import type { Board, Tile } from "../../game/types";
import type { BoardBrief } from "./briefSchema";

function inBounds(size: number, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < size && y < size;
}

function key(x: number, y: number): string {
  return `${x},${y}`;
}

function isWalkable(tile: Tile): boolean {
  return tile !== "lake" && tile !== "river";
}

function neighbors4(x: number, y: number): Array<[number, number]> {
  return [
    [x + 1, y],
    [x - 1, y],
    [x, y + 1],
    [x, y - 1],
  ];
}

export function validateBoard(board: Board, brief: BoardBrief, size: number): string | null {
  const tiles = board.tiles;
  if (tiles.length !== size || tiles.some((row) => row.length !== size)) {
    return "board has wrong dimensions";
  }

  const reserved = (y: number) => y <= 1 || y >= size - 2;

  const riverTiles: Array<[number, number]> = [];
  const bridgeTiles: Array<[number, number]> = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const t = tiles[y][x];
      if (t === "river") riverTiles.push([x, y]);
      if (t === "bridge") bridgeTiles.push([x, y]);
    }
  }

  if (brief.river) {
    // Invariant 1: river exists as one connected simple path spanning left edge -> right edge
    const riverish = new Set<string>();
    for (const [x, y] of riverTiles) riverish.add(key(x, y));
    for (const [x, y] of bridgeTiles) riverish.add(key(x, y));

    if (riverish.size === 0) return "river missing";

    const riverishCells = Array.from(riverish).map(
      (k) => k.split(",").map(Number) as [number, number],
    );
    const leftEdgeCells = riverishCells.filter(([x]) => x === 0);
    const rightEdgeCells = riverishCells.filter(([x]) => x === size - 1);
    if (leftEdgeCells.length === 0 || rightEdgeCells.length === 0) {
      return "river must span left and right edges";
    }

    let endpointCount = 0;
    for (const [x, y] of riverishCells) {
      const deg = neighbors4(x, y).filter(
        ([nx, ny]) => inBounds(size, nx, ny) && riverish.has(key(nx, ny)),
      ).length;
      if (deg === 1) {
        endpointCount++;
        if (x !== 0 && x !== size - 1) return "river endpoint must be on left or right edge";
      } else if (deg !== 2) {
        return "river tile must have degree 2";
      }
    }
    if (endpointCount !== 2) return "river must have exactly two endpoints";

    // connected: BFS from a left-edge river cell covers all
    const start = leftEdgeCells[0];
    const q: Array<[number, number]> = [start];
    const seen = new Set<string>([key(start[0], start[1])]);
    while (q.length > 0) {
      const [x, y] = q.shift()!;
      for (const [nx, ny] of neighbors4(x, y)) {
        if (!inBounds(size, nx, ny)) continue;
        const nk = key(nx, ny);
        if (!riverish.has(nk) || seen.has(nk)) continue;
        seen.add(nk);
        q.push([nx, ny]);
      }
    }
    if (seen.size !== riverish.size) return "river must be a single connected path";

    // Invariant 2
    for (const [x, y] of riverTiles) {
      if (reserved(y)) return "river passes through reserved row";
      const t = tiles[y][x];
      if (t !== "river") return "river tile mismatch";
    }
    for (const [x, y] of riverTiles) {
      // cannot overlap lake/rock (tile is river already, so just ensure none are lake/rock-typed in river set - implied)
      void x;
      void y;
    }

    // Invariant 3
    if (bridgeTiles.length !== brief.bridgeTiles) return "bridge count mismatch";
    for (const [x, y] of bridgeTiles) {
      if (!riverish.has(key(x, y))) return "bridge not on river path";
      // every bridge lies on a horizontal run: immediate left and right neighbors are river/bridge
      const leftOk = inBounds(size, x - 1, y) && riverish.has(key(x - 1, y));
      const rightOk = inBounds(size, x + 1, y) && riverish.has(key(x + 1, y));
      if (!leftOk || !rightOk) return "bridge not on a horizontal run";
    }
  } else {
    // riverless: no river tiles; bridges ignored (but there should be none placed as river)
    if (riverTiles.length !== 0) return "riverless brief must have no river tiles";
    // bridges may exist? shouldn't be placed; treat as invalid if present from carve, but materializer won't place
  }

  // Invariant 4: crossability BFS from player's spawn area to enemy's spawn area
  const playerSpawn: Array<[number, number]> = [];
  const enemySpawn: Array<[number, number]> = [];
  for (let y = size - 2; y <= size - 1; y++)
    for (let x = 0; x < size; x++) playerSpawn.push([x, y]);
  for (let y = 0; y <= 1; y++) for (let x = 0; x < size; x++) enemySpawn.push([x, y]);

  const canCross = (() => {
    const seen = new Set<string>();
    const q: Array<[number, number]> = [];
    for (const [x, y] of playerSpawn) {
      const t = tiles[y][x];
      if (!isWalkable(t)) continue;
      const k = key(x, y);
      if (!seen.has(k)) {
        seen.add(k);
        q.push([x, y]);
      }
    }
    const enemySet = new Set(enemySpawn.map(([x, y]) => key(x, y)));
    while (q.length > 0) {
      const [x, y] = q.shift()!;
      if (enemySet.has(key(x, y))) return true;
      for (const [nx, ny] of neighbors4(x, y)) {
        if (!inBounds(size, nx, ny)) continue;
        const nk = key(nx, ny);
        if (seen.has(nk)) continue;
        if (!isWalkable(tiles[ny][nx])) continue;
        seen.add(nk);
        q.push([nx, ny]);
      }
    }
    return false;
  })();
  if (!canCross) return "board is not crossable";

  // Invariant 6: no water in reserved rows; spawn tiles free of obstacles
  for (const [x, y] of [...playerSpawn, ...enemySpawn]) {
    const t = tiles[y][x];
    if (t === "lake" || t === "river") return "water in reserved row";
    // "free of obstacles" - reserved forced plain by materializer, but validate
    if (t !== "plain" && t !== "forest" && t !== "hill" && t !== "bridge" && t !== "rock") {
      // any non-walkable obstacle would be bad; plain/forest/hill/rock are walkable? walkable means not lake/river.
      // but spawn tiles must be safe/walkable plain/terrain-safe and within reserved spawn rows (inv 5 context)
    }
    if (!isWalkable(t)) return "spawn tile not walkable";
  }

  return null;
}
