import type { Board, Tile, Unit } from "../../game/types.js";
import type { AppConfig } from "../../config/index.js";
import type { BoardBrief } from "./briefSchema.js";
import { createRng, type Rng } from "./prng.js";
import { createArmies, normalizeUnitIds } from "./spawn.js";

export interface MaterializedBoard {
  board: Board;
  units: Unit[];
}

export function materialize(brief: BoardBrief, seed: string, config: AppConfig): MaterializedBoard {
  const size = config.boardSize;
  const rng = createRng(seed);
  const tiles: Tile[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => "plain" as Tile),
  );

  const riverCells = new Set<string>();
  if (brief.river) {
    carveRiver(tiles, brief, size, rng, riverCells);
    placeBridges(tiles, brief, size, rng, riverCells);
  }

  if (brief.lake) {
    paintBlob(tiles, brief.lake, "lake", size, (x, y, t) => {
      if (isReservedRow(y, size)) return false;
      if (t === "river" || t === "bridge") return false;
      if (isAdjacentToBridge(tiles, x, y, size)) return false;
      return true;
    });
  }

  for (const zone of brief.forestZones) {
    paintBlob(tiles, zone, "forest", size, (x, y, t) => {
      if (isReservedRow(y, size)) return false;
      if (t === "river" || t === "bridge" || t === "lake" || t === "rock") return false;
      return true;
    });
  }

  for (const zone of brief.hillZones) {
    paintBlob(tiles, zone, "hill", size, (x, y, t) => {
      if (isReservedRow(y, size)) return false;
      if (t === "river" || t === "bridge" || t === "lake" || t === "rock") return false;
      return true;
    });
  }

  placeRocks(tiles, size, rng);

  // Reserved rows forced plain (spawn safety absolute)
  for (const y of [0, 1, size - 2, size - 1]) {
    for (let x = 0; x < size; x++) {
      tiles[y]![x] = "plain";
    }
  }

  const units = normalizeUnitIds(createArmies(size, config, rng));
  return { board: { tiles }, units };
}

function key(x: number, y: number): string {
  return `${x},${y}`;
}

function neighbors4(x: number, y: number): Array<[number, number]> {
  return [
    [x + 1, y],
    [x - 1, y],
    [x, y + 1],
    [x, y - 1],
  ];
}

function isReservedRow(y: number, size: number): boolean {
  return y === 0 || y === 1 || y === size - 2 || y === size - 1;
}

function isAdjacentToBridge(tiles: Tile[][], x: number, y: number, size: number): boolean {
  for (const [nx, ny] of neighbors4(x, y)) {
    if (nx < 0 || nx >= size || ny < 0 || ny >= size) continue;
    if (tiles[ny]![nx] === "bridge") return true;
  }
  return false;
}

function carveRiver(
  tiles: Tile[][],
  brief: BoardBrief,
  size: number,
  rng: Rng,
  riverCells: Set<string>,
): void {
  const river = brief.river!;
  const path = buildRiverPath(brief, size, rng, river.startRow, river.endRow, river.bends);
  for (const [x, y] of path) {
    if (y >= 0 && y < size && x >= 0 && x < size) {
      tiles[y]![x] = "river";
      riverCells.add(key(x, y));
    }
  }
}

function buildRiverPath(
  _brief: BoardBrief,
  size: number,
  rng: Rng,
  startY: number,
  endY: number,
  bends: number,
): Array<[number, number]> {
  const minY = 2;
  const maxY = size - 3;
  const targetX = size - 1;

  // preferred y by segment to create bends and steer to endY
  const segments = bends + 1;
  const segTargets: number[] = [];
  for (let i = 1; i <= segments; i++) {
    if (i === segments) segTargets.push(endY);
    else {
      const t = i / segments;
      const base = Math.round(startY + (endY - startY) * t);
      segTargets.push(clamp(base + rng.int(-1, 1), minY, maxY));
    }
  }

  function segmentTarget(x: number): number {
    const seg = Math.min(segments - 1, Math.floor((x / Math.max(1, targetX)) * segments));
    return segTargets[seg] ?? endY;
  }

  // Try multiple randomized self-avoiding walks; fall back to simple monotone path if needed.
  for (let attempt = 0; attempt < 80; attempt++) {
    const path: Array<[number, number]> = [[0, startY]];
    const occupied = new Set<string>([key(0, startY)]);
    let ok = true;

    while (true) {
      const cur = path[path.length - 1]!;
      const [cx, cy] = cur;
      if (cx === targetX && cy === endY) break;

      const neighbors = neighbors4(cx, cy).filter(([nx, ny]: [number, number]) => {
        if (nx < 0 || nx >= size || ny < minY || ny > maxY) return false;
        // keep a single river cell on each edge (start/end only)
        if (nx === 0) return false;
        const k = key(nx, ny);
        if (occupied.has(k)) return false;
        if (nx < cx) return false;
        // simple-path: neighbor must not be adjacent to any occupied cell other than current
        for (const [ax, ay] of neighbors4(nx, ny)) {
          if (ax === cx && ay === cy) continue;
          if (occupied.has(key(ax, ay))) return false;
        }
        // must remain possible to reach right edge (simple necessary condition)
        if (nx === targetX && ny !== endY) return false;
        return true;
      });

      if (neighbors.length === 0) {
        ok = false;
        break;
      }

      // score moves: prefer right, and steer y toward segment target / endY
      const tgtY = cx >= targetX - 1 ? endY : segmentTarget(cx);
      const scored = neighbors
        .map(([nx, ny]: [number, number]) => {
          let score = 0;
          if (nx > cx) score += 6;
          else if (nx === cx) score += 2;
          else score -= 3;
          const distTarget = Math.abs(ny - tgtY) + Math.abs(nx - targetX) * 0.2;
          score -= distTarget * 1.5;
          score += rng.next() * 2.4;
          if (nx === cx) score += 0.2;
          return { nx, ny, score };
        })
        .sort((a: { score: number }, b: { score: number }) => b.score - a.score);

      // Pick stochastically among near-best moves so the same brief with different seeds
      // can yield different river shapes (while same brief+seed remains deterministic).
      const bestScore = scored[0]!.score;
      let top = scored.filter((s) => s.score >= bestScore - 2.0);
      if (top.length < 2 && scored.length > 1) {
        top = scored.slice(0, Math.min(2, scored.length));
      }
      const choice = top[rng.int(0, top.length - 1)]!;
      path.push([choice.nx, choice.ny]);
      occupied.add(key(choice.nx, choice.ny));

      if (path.length > size * size) {
        ok = false;
        break;
      }
    }

    if (!ok) continue;

    // must span left to right edge and not be straight if possible (bends>=1 implies variation expected)
    const ys = new Set(path.map((p) => p[1]));
    if (ys.size === 1 && size > 3) {
      // try to inject a bend if straight
      // ignore and retry; attempts will vary
      if (attempt < 79) continue;
    }

    // basic endpoint sanity
    if (path[0]![0] === 0 && path[path.length - 1]![0] === targetX) {
      return path;
    }
  }

  // deterministic fallback: simple monotone staircase (may touch itself rarely, but very unlikely)
  const fallback: Array<[number, number]> = [[0, startY]];
  let cy = startY;
  for (let x = 0; x < targetX; x++) {
    const nextY =
      x + 1 === targetX ? endY : clamp(cy + (endY > cy ? 1 : endY < cy ? -1 : 0), minY, maxY);
    while (cy !== nextY) {
      cy += Math.sign(nextY - cy);
      fallback.push([x, cy]);
    }
    fallback.push([x + 1, cy]);
  }
  if (cy !== endY) {
    while (cy !== endY) {
      cy += Math.sign(endY - cy);
      fallback.push([targetX, cy]);
    }
  }
  return fallback;
}

function placeBridges(
  tiles: Tile[][],
  brief: BoardBrief,
  size: number,
  rng: Rng,
  riverCells: Set<string>,
): void {
  if (!brief.river) return;
  const want = brief.bridgeTiles;

  const candidates: Array<[number, number]> = [];
  for (const k of riverCells) {
    const [xs, ys] = k.split(",");
    const x = Number(xs);
    const y = Number(ys);
    if (x <= 0 || x >= size - 1) continue;
    const left = tiles[y]?.[x - 1];
    const right = tiles[y]?.[x + 1];
    if ((left === "river" || left === "bridge") && (right === "river" || right === "bridge")) {
      candidates.push([x, y]);
    }
  }

  if (candidates.length === 0) return;

  const pickNearestTo = (targetX: number): [number, number] => {
    let best = candidates[0]!;
    let bestDist = Math.abs(best[0] - targetX);
    for (const c of candidates) {
      const d = Math.abs(c[0] - targetX);
      if (d < bestDist) {
        best = c;
        bestDist = d;
      }
    }
    return best;
  };

  const chosen: Array<[number, number]> = [];
  if (want === 1) {
    chosen.push(pickNearestTo(Math.floor((size - 1) / 2)));
  } else {
    const q1 = Math.floor((size - 1) / 4);
    const q3 = Math.floor(((size - 1) * 3) / 4);
    const c1 = pickNearestTo(q1);
    chosen.push(c1);
    // pick farthest from c1 among candidates, preferring near q3
    let c2 = pickNearestTo(q3);
    if (c2[0] === c1[0] && c2[1] === c1[1]) {
      const alt = candidates
        .filter((c) => !(c[0] === c1[0] && c[1] === c1[1]))
        .sort((a, b) => Math.abs(b[0] - c1[0]) - Math.abs(a[0] - c1[0]))[0];
      if (alt) c2 = alt;
    }
    if (!(c2[0] === c1[0] && c2[1] === c1[1])) chosen.push(c2);
    else if (candidates.length > 1) {
      const alt = candidates.find((c) => !(c[0] === c1[0] && c[1] === c1[1]));
      if (alt) chosen.push(alt);
    }
  }

  for (const [x, y] of chosen.slice(0, want)) {
    tiles[y]![x] = "bridge";
  }
}

function paintBlob(
  tiles: Tile[][],
  zone: { centerX: number; centerY: number; radius: number },
  tile: Tile,
  size: number,
  canPaint: (x: number, y: number, current: Tile) => boolean,
): void {
  const r = zone.radius;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const x = zone.centerX + dx;
      const y = zone.centerY + dy;
      if (x < 0 || x >= size || y < 0 || y >= size) continue;
      const cur = tiles[y]![x]!;
      if (canPaint(x, y, cur)) {
        tiles[y]![x] = tile;
      }
    }
  }
}

function placeRocks(tiles: Tile[][], size: number, rng: Rng): void {
  // a few rocks purely cosmetically (seeded, skip water/reserved)
  const count = rng.int(2, 5);
  let placed = 0;
  let attempts = 0;
  while (placed < count && attempts < 200) {
    attempts++;
    const x = rng.int(0, size - 1);
    const y = rng.int(0, size - 1);
    if (isReservedRow(y, size)) continue;
    if (isAdjacentToBridge(tiles, x, y, size)) continue;
    const t = tiles[y]![x]!;
    if (t !== "plain" && t !== "forest" && t !== "hill") continue;
    tiles[y]![x] = "rock";
    placed++;
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
