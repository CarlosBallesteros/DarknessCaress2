import type { Board, Tile } from "../../game/types";
import type { BoardBrief } from "./briefSchema";

export interface MaterializedBoard {
  board: Board;
}

function hashStringToUint32(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng: () => number, min: number, max: number): number {
  if (max < min) return min;
  return Math.floor(rng() * (max - min + 1)) + min;
}

function createGrid(size: number, fill: Tile): Tile[][] {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => fill));
}

function inBounds(size: number, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < size && y < size;
}

function key(x: number, y: number): string {
  return `${x},${y}`;
}

export function makeRng(brief: BoardBrief, seed: string, attempt: number): () => number {
  const h = hashStringToUint32(`${seed}|${attempt}|${JSON.stringify(brief)}`);
  return mulberry32(h);
}

function buildRiverPath(
  size: number,
  river: { startRow: number; endRow: number; bends: number },
  rng: () => number,
): Array<[number, number]> {
  const minY = 2;
  const maxY = size - 3;
  const y: number[] = Array.from({ length: size }, () => river.startRow);
  y[0] = river.startRow;
  y[size - 1] = river.endRow;

  const segments = river.bends + 1;
  const segmentEnds: number[] = [];
  for (let s = 1; s <= segments; s++) {
    segmentEnds.push(Math.round((s * (size - 1)) / segments));
  }
  segmentEnds[segmentEnds.length - 1] = size - 1;

  const targets: number[] = Array.from({ length: segmentEnds.length }, () => river.endRow);
  for (let s = 0; s < segmentEnds.length - 1; s++) {
    const progress = (s + 1) / segments;
    const base = Math.round(river.startRow + (river.endRow - river.startRow) * progress);
    const delta = randInt(rng, -1, 1);
    targets[s] = Math.min(maxY, Math.max(minY, base + delta));
  }
  targets[targets.length - 1] = river.endRow;

  let prevDir = 0; // sign of y[x]-y[x-1], 0 at start
  let segIndex = 0;

  for (let x = 1; x < size - 1; x++) {
    while (segIndex < segmentEnds.length - 1 && x > segmentEnds[segIndex]) {
      segIndex++;
    }
    const segEndX = segmentEnds[segIndex];
    const segEndY = targets[segIndex];
    const remaining = segEndX - x;
    const cur = y[x - 1];
    const need = segEndY - cur;

    // feasible step dirs given remaining moves after this step
    const feasible: number[] = [];
    for (const d of [-1, 0, 1]) {
      const ny = cur + d;
      if (ny < minY || ny > maxY) continue;
      if (Math.abs(segEndY - ny) <= remaining) feasible.push(d);
    }

    // prefer directions that don't immediately reverse (prevents self-adjacency)
    let allowed = feasible.filter((d) => !(prevDir !== 0 && d === -prevDir));
    if (allowed.length === 0) allowed = feasible.slice();
    if (allowed.length === 0) allowed = [0];

    // steer: prefer flat for bridge runs, but must be able to reach target
    let dir = 0;
    const want = Math.sign(need);
    const toward = allowed.includes(want) ? want : 0;
    const roll = rng();
    if (allowed.includes(0) && roll < 0.5) {
      dir = 0;
    } else if (toward !== 0 && allowed.includes(toward) && roll < 0.8) {
      dir = toward;
    } else {
      dir = allowed[randInt(rng, 0, allowed.length - 1)];
    }

    // if must move toward target, do it
    if (Math.abs(need) > remaining && allowed.includes(want)) {
      dir = want;
    } else if (Math.abs(need) === remaining && remaining > 0 && allowed.includes(want)) {
      dir = want;
    }

    y[x] = cur + dir;
    prevDir = Math.sign(y[x] - cur);
  }

  // final approach: ensure can reach endRow in last step (column size-2 -> size-1)
  // adjust y[size-2] if needed
  y[size - 1] = river.endRow;
  if (Math.abs(river.endRow - y[size - 2]) > 1) {
    y[size - 2] = river.endRow + (y[size - 2] > river.endRow ? 1 : -1);
    if (y[size - 2] < minY) y[size - 2] = minY;
    if (y[size - 2] > maxY) y[size - 2] = maxY;
  }

  // ensure not straight
  const allEqual = y.every((v) => v === y[0]);
  if (allEqual) {
    if (y[1] < maxY) {
      y[1] = y[1] + 1;
      if (y[2] < maxY && Math.abs(y[2] - y[1]) <= 1) {
        // keep valid
      } else {
        y[2] = y[1];
      }
    } else {
      y[1] = y[1] - 1;
      y[2] = y[1];
    }
  }

  const path: Array<[number, number]> = [[0, y[0]]];
  for (let x = 0; x < size - 1; x++) {
    const fromY = y[x];
    const toY = y[x + 1];
    const step = toY >= fromY ? 1 : -1;
    for (let yy = fromY + step; step > 0 ? yy <= toY : yy >= toY; yy += step) {
      path.push([x, yy]);
    }
    path.push([x + 1, toY]);
  }
  return path;
}

export function materializeBoard(brief: BoardBrief, seed: string, attempt = 0): MaterializedBoard {
  const size = 8; // baseline; brief/schema assume 8x8 per docs
  const rng = makeRng(brief, seed, attempt);
  const tiles = createGrid(size, "plain");

  const riverPath: Array<[number, number]> = [];
  const riverSet = new Set<string>();
  if (brief.river) {
    const path = buildRiverPath(size, brief.river, rng);
    for (const [x, y] of path) {
      if (!inBounds(size, x, y)) continue;
      if (y <= 1 || y >= size - 2) continue; // keep out of reserved during carve attempt
      if (!riverSet.has(key(x, y))) {
        riverSet.add(key(x, y));
        riverPath.push([x, y]);
        tiles[y][x] = "river";
      }
    }
  }

  // Bridges
  const bridgeSet = new Set<string>();
  const protectedCrossing = new Set<string>();
  if (brief.river && riverPath.length > 0) {
    const isRiverish = (x: number, y: number) =>
      riverSet.has(key(x, y)) || bridgeSet.has(key(x, y));
    const candidates = riverPath.filter(([x, y]) => {
      return isRiverish(x - 1, y) && isRiverish(x + 1, y);
    });
    const want = brief.bridgeTiles;
    const chosen: Array<[number, number]> = [];
    if (candidates.length > 0) {
      const byQuarter = (q: number) => {
        const targetX = Math.floor((q * (size - 1)) / 4);
        let best: [number, number] | null = null;
        let bestD = Infinity;
        for (const c of candidates) {
          if (chosen.some((ch) => ch[0] === c[0] && ch[1] === c[1])) continue;
          const d = Math.abs(c[0] - targetX);
          if (d < bestD) {
            bestD = d;
            best = c;
          }
        }
        return best;
      };
      if (want === 1) {
        const mid = byQuarter(2);
        if (mid) chosen.push(mid);
      } else {
        const q1 = byQuarter(1);
        if (q1) chosen.push(q1);
        const q3 = byQuarter(3);
        if (q3) chosen.push(q3);
        if (chosen.length < 2) {
          const any = byQuarter(2);
          if (any && !chosen.some((c) => c[0] === any[0] && c[1] === any[1])) chosen.push(any);
        }
      }
      // fallback fill if still short
      for (const c of candidates) {
        if (chosen.length >= want) break;
        if (!chosen.some((ch) => ch[0] === c[0] && ch[1] === c[1])) chosen.push(c);
      }
    }
    for (const [x, y] of chosen) {
      tiles[y][x] = "bridge";
      bridgeSet.add(key(x, y));
      riverSet.delete(key(x, y)); // bridge replaces river tile
      // horizontal-run bridge: keep vertical crossing approaches passable
      protectedCrossing.add(key(x, y - 1));
      protectedCrossing.add(key(x, y + 1));
    }
  }

  const isReserved = (y: number) => y <= 1 || y >= size - 2;

  function paintBlob(
    centerX: number,
    centerY: number,
    radius: number,
    tile: Tile,
    canPaint: (x: number, y: number) => boolean,
  ): void {
    const r2 = radius * radius;
    for (let y = centerY - radius; y <= centerY + radius; y++) {
      for (let x = centerX - radius; x <= centerX + radius; x++) {
        if (!inBounds(size, x, y)) continue;
        const dx = x - centerX;
        const dy = y - centerY;
        if (dx * dx + dy * dy > r2) continue;
        if (!canPaint(x, y)) continue;
        tiles[y][x] = tile;
      }
    }
  }

  // Lake
  if (brief.lake) {
    paintBlob(brief.lake.centerX, brief.lake.centerY, brief.lake.radius, "lake", (x, y) => {
      if (isReserved(y)) return false;
      if (protectedCrossing.has(key(x, y))) return false;
      const t = tiles[y][x];
      return t !== "river" && t !== "bridge";
    });
  }

  // Forests
  for (const z of brief.forestZones) {
    paintBlob(z.centerX, z.centerY, z.radius, "forest", (x, y) => {
      if (isReserved(y)) return false;
      if (protectedCrossing.has(key(x, y))) return false;
      const t = tiles[y][x];
      return t !== "river" && t !== "bridge" && t !== "lake" && t !== "rock";
    });
  }

  // Hills
  for (const z of brief.hillZones) {
    paintBlob(z.centerX, z.centerY, z.radius, "hill", (x, y) => {
      if (isReserved(y)) return false;
      if (protectedCrossing.has(key(x, y))) return false;
      const t = tiles[y][x];
      return t !== "river" && t !== "bridge" && t !== "lake" && t !== "rock";
    });
  }

  // Rocks (cosmetic, few)
  const rockCount = randInt(rng, 1, 4);
  let placedRocks = 0;
  let rockAttempts = 0;
  while (placedRocks < rockCount && rockAttempts < 100) {
    rockAttempts++;
    const x = randInt(rng, 0, size - 1);
    const y = randInt(rng, 2, size - 3);
    if (isReserved(y)) continue;
    const t = tiles[y][x];
    if (t === "plain") {
      tiles[y][x] = "rock";
      placedRocks++;
    }
  }

  // Reserved rows forced plain
  for (let x = 0; x < size; x++) {
    tiles[0][x] = "plain";
    tiles[1][x] = "plain";
    tiles[size - 2][x] = "plain";
    tiles[size - 1][x] = "plain";
  }

  return { board: { tiles } };
}

export function boardSeedFromGameId(gameId: string): string {
  return gameId;
}

export function createPlainPlaceholderBoard(size: number): Board {
  return { tiles: createGrid(size, "plain") };
}
