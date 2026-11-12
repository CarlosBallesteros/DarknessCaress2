import type { Board, GameEngineConfig, Unit } from "./types";

function inBounds(x: number, y: number, size: number): boolean {
  return x >= 0 && y >= 0 && x < size && y < size;
}

function isWater(board: Board, x: number, y: number): boolean {
  const tile = board.tiles[y]?.[x];
  return tile === "lake" || tile === "river";
}

function findUnitAt(units: Unit[], x: number, y: number): Unit | undefined {
  return units.find((u) => u.x === x && u.y === y);
}

function keyOf(x: number, y: number): string {
  return `${x},${y}`;
}

function neighbors(x: number, y: number): [number, number][] {
  return [
    [x + 1, y],
    [x - 1, y],
    [x, y + 1],
    [x, y - 1],
  ];
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
  const queue: Array<{ x: number; y: number; d: number }> = [{ x: unit.x, y: unit.y, d: 0 }];
  visited.set(keyOf(unit.x, unit.y), 0);

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.d >= mov) continue;
    for (const [nx, ny] of neighbors(current.x, current.y)) {
      if (!inBounds(nx, ny, size)) continue;
      if (isWater(board, nx, ny)) continue;
      const occupant = findUnitAt(units, nx, ny);
      if (occupant && occupant.side !== unit.side) continue; // cannot enter enemy
      const k = keyOf(nx, ny);
      const nd = current.d + 1;
      const prev = visited.get(k);
      if (prev !== undefined && prev <= nd) continue;
      visited.set(k, nd);
      queue.push({ x: nx, y: ny, d: nd });
    }
  }

  const result = new Set<string>();
  for (const [k, d] of visited.entries()) {
    if (d === 0) continue; // staying put is handled by path; reachable set of destination tiles
    const [sx, sy] = k.split(",").map(Number);
    const occupant = findUnitAt(units, sx, sy);
    if (occupant && occupant.id !== unit.id) continue; // cannot end on occupied tile
    result.add(k);
  }
  // unit's own tile is a legal destination only as a wait (1-entry path) but not listed as a moved-to tile by distance>0
  return result;
}

export function isPathLegal(
  board: Board,
  units: Unit[],
  unit: Unit,
  path: [number, number][],
  cfg: GameEngineConfig,
): string | null {
  const size = cfg.boardSize;
  if (path.length === 0) {
    return "path must start at the unit's tile";
  }
  const [sx, sy] = path[0];
  if (sx !== unit.x || sy !== unit.y) {
    return "path must start at the unit's tile";
  }

  const mov = cfg.classes[unit.class].mov;
  const edges = path.length - 1;
  if (edges > mov) {
    return `path length ${edges} exceeds movement ${mov}`;
  }

  for (let i = 0; i < path.length; i++) {
    const [x, y] = path[i];
    if (!inBounds(x, y, size)) {
      return `path step (${x},${y}) is outside the board`;
    }
    if (i > 0) {
      const [px, py] = path[i - 1];
      if (Math.abs(x - px) + Math.abs(y - py) !== 1) {
        return `path step (${x},${y}) is not adjacent to the previous step`;
      }
      if (isWater(board, x, y)) {
        return `path step (${x},${y}) is water`;
      }
      const occupant = findUnitAt(units, x, y);
      if (occupant && occupant.side !== unit.side) {
        return `path enters an enemy unit at (${x},${y})`;
      }
    }
  }

  const [ex, ey] = path[path.length - 1];
  const endOccupant = findUnitAt(units, ex, ey);
  if (endOccupant && endOccupant.id !== unit.id) {
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
  const size = cfg.boardSize;
  const mov = cfg.classes[unit.class].mov;
  const [dx, dy] = dest;
  if (!inBounds(dx, dy, size)) return null;
  if (isWater(board, dx, dy)) return null;
  const destOccupant = findUnitAt(units, dx, dy);
  if (destOccupant && destOccupant.id !== unit.id) return null;

  const startKey = keyOf(unit.x, unit.y);
  const prev = new Map<string, string | null>();
  const dist = new Map<string, number>();
  const queue: Array<[number, number]> = [[unit.x, unit.y]];
  prev.set(startKey, null);
  dist.set(startKey, 0);

  while (queue.length > 0) {
    const [cx, cy] = queue.shift()!;
    const cd = dist.get(keyOf(cx, cy))!;
    if (cd >= mov) continue;
    for (const [nx, ny] of neighbors(cx, cy)) {
      if (!inBounds(nx, ny, size)) continue;
      if (isWater(board, nx, ny)) continue;
      const occupant = findUnitAt(units, nx, ny);
      if (occupant && occupant.side !== unit.side) continue;
      const nk = keyOf(nx, ny);
      if (prev.has(nk)) continue;
      prev.set(nk, keyOf(cx, cy));
      dist.set(nk, cd + 1);
      if (nx === dx && ny === dy) {
        // reconstruct
        const path: Array<[number, number]> = [];
        let cur: string | null = nk;
        while (cur !== null) {
          const [px, py] = cur.split(",").map(Number);
          path.push([px, py]);
          cur = prev.get(cur) ?? null;
        }
        path.reverse();
        return path;
      }
      queue.push([nx, ny]);
    }
  }

  return null;
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
  const mov = cfg.classes[unit.class].mov;
  const size = cfg.boardSize;
  const visited = new Map<string, number>();
  const queue: Array<{ x: number; y: number; d: number }> = [{ x: unit.x, y: unit.y, d: 0 }];
  visited.set(keyOf(unit.x, unit.y), 0);
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.d >= mov) continue;
    for (const [nx, ny] of neighbors(current.x, current.y)) {
      if (!inBounds(nx, ny, size)) continue;
      if (isWater(board, nx, ny)) continue;
      const occupant = findUnitAt(units, nx, ny);
      if (occupant && occupant.side !== unit.side) continue;
      const k = keyOf(nx, ny);
      const nd = current.d + 1;
      const prev = visited.get(k);
      if (prev !== undefined && prev <= nd) continue;
      visited.set(k, nd);
      queue.push({ x: nx, y: ny, d: nd });
    }
  }

  const moveTiles: [number, number][] = [];
  const finalTiles: [number, number][] = [];
  for (const [k] of visited.entries()) {
    const [x, y] = k.split(",").map(Number);
    const occupant = findUnitAt(units, x, y);
    if (occupant && occupant.id !== unit.id) continue;
    finalTiles.push([x, y]);
    if (!(x === unit.x && y === unit.y)) {
      moveTiles.push([x, y]);
    }
  }

  const classCfg = cfg.classes[unit.class];
  const attackTilesSet = new Set<string>();
  const healTilesSet = new Set<string>();

  if (classCfg.role !== "supporter" || classCfg.atk > 0) {
    // attackers and mage/archer (supporters with atk>0) can attack in preview
  }

  for (const [fx, fy] of finalTiles) {
    if (classCfg.atk > 0) {
      for (const target of units) {
        if (target.side === unit.side) continue;
        if (target.hp <= 0) continue;
        const dist = Math.abs(target.x - fx) + Math.abs(target.y - fy);
        if (classCfg.range.includes(dist)) {
          attackTilesSet.add(keyOf(target.x, target.y));
        }
      }
    }
    if (unit.class === "healer") {
      const healAmount = classCfg.healAmount ?? 0;
      void healAmount;
      for (const target of units) {
        if (target.side !== unit.side) continue;
        if (target.hp <= 0) continue;
        if (target.hp >= target.maxHp) continue;
        const dist = Math.abs(target.x - fx) + Math.abs(target.y - fy);
        if (dist === 1) {
          healTilesSet.add(keyOf(target.x, target.y));
        }
      }
    }
  }

  const attackTiles = Array.from(attackTilesSet).map(
    (k) => k.split(",").map(Number) as [number, number],
  );
  const healTiles = Array.from(healTilesSet).map(
    (k) => k.split(",").map(Number) as [number, number],
  );

  return { moveTiles, attackTiles, healTiles };
}
