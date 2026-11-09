import type { Board, GameEngineConfig, Tile } from "../../game/types.js";
import type { Brief } from "./briefSchema.js";
import { createRng } from "./rng.js";
import type { SeededRng } from "./rng.js";

/**
 * Stage 2 (03): deterministic materialization of a parsed brief into a real
 * grid. The SAME brief + seed always produces the SAME board. Validity is the
 * validator's job (invariants.ts), not the walk's.
 */
export function materialize(
  brief: Brief,
  seed: number,
  cfg: GameEngineConfig,
): Board {
  const size = cfg.boardSize;
  const reservedRows = new Set([0, 1, size - 2, size - 1]);
  // 03 step 1: grid init — every tile plain.
  const tiles: Tile[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => "plain" as Tile),
  );
  const rng = createRng(seed);

  // 03 steps 2-3: river + bridges (skipped entirely when the brief is riverless).
  if (brief.river) {
    carveRiver(tiles, brief.river, size, rng);
    placeBridges(tiles, brief.bridgeTiles, size);
  }
  // 03 step 4: lake — skips river, bridge and reserved rows.
  if (brief.lake) {
    paintBlob(tiles, brief.lake, "lake", size, reservedRows);
  }
  // 03 step 5: forest/hill zones — additionally skip lake and rock.
  for (const zone of brief.forestZones) {
    paintBlob(tiles, zone, "forest", size, reservedRows);
  }
  for (const zone of brief.hillZones) {
    paintBlob(tiles, zone, "hill", size, reservedRows);
  }
  // 03 step 6: a few cosmetic rocks.
  sprinkleRocks(tiles, rng, size, reservedRows);
  // 03 step 7: reserved rows forced plain LAST — spawn safety is absolute.
  for (const y of reservedRows) {
    for (let x = 0; x < size; x++) {
      tiles[y][x] = "plain";
    }
  }
  return { tiles };
}

/**
 * 03 step 2: a seeded random walk from (0, startRow) rightward to
 * (size-1, endRow), preferring right, with short bounded vertical runs toward
 * the current segment's target row. bends splits the walk into bends+1
 * segments, each carrying a seeded target steered along the way to endRow; the
 * last segment's target is endRow exactly and always closes on it.
 *
 * The walk never reverses direction on the column right after a run: adjacent
 * columns with overlapping vertical extents would self-touch (degree-3 river
 * tiles). One flat column between opposite runs keeps the path simple; the
 * invariants validator remains the hard guarantee either way.
 */
function carveRiver(
  tiles: Tile[][],
  river: Brief["river"] & {},
  size: number,
  rng: SeededRng,
): void {
  const clampRow = (row: number): number =>
    Math.max(2, Math.min(size - 3, row));
  const segments = river.bends + 1;
  const targets: number[] = [];
  for (let s = 0; s < segments; s++) {
    if (s === segments - 1) {
      targets.push(clampRow(river.endRow));
    } else {
      const base =
        river.startRow + ((river.endRow - river.startRow) * s) / segments;
      targets.push(clampRow(Math.round(base) + rng.int(5) - 2));
    }
  }

  let row = clampRow(river.startRow);
  tiles[row][0] = "river";
  // The edge tiles are write-only entries: vertical runs never happen at
  // columns 0 or size-1, so both edge tiles keep exactly one river neighbor.
  let lastRunColumn = -1;
  let lastRunDirection = 0;
  for (let x = 0; x <= size - 2; x++) {
    if (x >= 1) {
      const segment = Math.min(
        segments - 1,
        Math.floor((x * segments) / (size - 1)),
      );
      const need = targets[segment] - row;
      const finalSegment = segment === segments - 1;
      // Non-final segments sidestep only occasionally (03: prefers right).
      if (need !== 0 && (finalSegment || rng.next() < 0.6)) {
        const direction = Math.sign(need);
        const reversing = direction === -lastRunDirection;
        const blocked =
          reversing && lastRunColumn !== -1 && x === lastRunColumn + 1;
        if (!blocked) {
          const remaining = size - 1 - x;
          // Short bounded runs (1-3); the final segment stretches only when
          // fewer columns remain than the distance still to close.
          const maxRun = finalSegment
            ? Math.max(3, Math.ceil(Math.abs(need) / remaining))
            : 3;
          const run = Math.min(Math.abs(need), maxRun);
          for (let i = 0; i < run; i++) {
            row += direction;
            tiles[row][x] = "river";
          }
          lastRunColumn = x;
          lastRunDirection = direction;
        }
      }
    }
    tiles[row][x + 1] = "river";
  }
}

/**
 * 03 step 3: bridges are picked from the river tiles — 2 as far apart as
 * possible (first/third quarter of width by column), 1 in the middle. Ties
 * resolve to the first tile in row-major order; deterministic.
 *
 * Only tiles the path runs STRAIGHT through (both water neighbors opposite
 * each other) are candidates: 03's bridges CROSS the river ("1 or 2 bridges
 * cross it when it exists"), and a bridge on a corner tile would have both
 * walkable exits on the same bank — it would lie on the path yet cross
 * nothing, which invariant 4 then rightly rejects.
 */
function placeBridges(
  tiles: Tile[][],
  bridgeTiles: number,
  size: number,
): void {
  const candidates: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (tiles[y][x] !== "river") {
        continue;
      }
      const horizontal =
        x > 0 &&
        x < size - 1 &&
        tiles[y][x - 1] === "river" &&
        tiles[y][x + 1] === "river";
      const vertical =
        y > 0 &&
        y < size - 1 &&
        tiles[y - 1][x] === "river" &&
        tiles[y + 1][x] === "river";
      if (horizontal || vertical) {
        candidates.push({ x, y });
      }
    }
  }
  const targets =
    bridgeTiles === 1
      ? [Math.floor((size - 1) / 2)]
      : [Math.round((size - 1) / 4), Math.round((3 * (size - 1)) / 4)];
  const chosen = new Set<string>();
  for (const target of targets) {
    const pool =
      candidates.length > 0 ? candidates : allRiverTiles(tiles, size);
    let best: { x: number; y: number; distance: number } | undefined;
    for (const { x, y } of pool) {
      if (chosen.has(`${x},${y}`)) {
        continue;
      }
      const distance = Math.abs(x - target);
      if (best === undefined || distance < best.distance) {
        best = { x, y, distance };
      }
    }
    if (best) {
      chosen.add(`${best.x},${best.y}`);
      tiles[best.y][best.x] = "bridge";
    }
  }
}

function allRiverTiles(
  tiles: Tile[][],
  size: number,
): Array<{ x: number; y: number }> {
  const all: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (tiles[y][x] === "river") {
        all.push({ x, y });
      }
    }
  }
  return all;
}

/** The classic (dx²+dy²) ≤ r² blob mask, bounded to the board and reserved rows. */
function paintBlob(
  tiles: Tile[][],
  zone: { centerX: number; centerY: number; radius: number },
  tile: Tile,
  size: number,
  reservedRows: Set<number>,
): void {
  for (
    let y = zone.centerY - zone.radius;
    y <= zone.centerY + zone.radius;
    y++
  ) {
    for (
      let x = zone.centerX - zone.radius;
      x <= zone.centerX + zone.radius;
      x++
    ) {
      if (x < 0 || x >= size || y < 0 || y >= size || reservedRows.has(y)) {
        continue;
      }
      const dx = x - zone.centerX;
      const dy = y - zone.centerY;
      if (dx * dx + dy * dy > zone.radius * zone.radius) {
        continue;
      }
      const current = tiles[y][x];
      // Lake skips river/bridge; forest/hill additionally skip lake/rock
      // (03 steps 4-5 skip lists).
      if (current === "river" || current === "bridge") {
        continue;
      }
      if (tile !== "lake" && (current === "lake" || current === "rock")) {
        continue;
      }
      tiles[y][x] = tile;
    }
  }
}

/** 03 step 6: ~8-12 rocks, seeded, skipping water and reserved rows. */
function sprinkleRocks(
  tiles: Tile[][],
  rng: SeededRng,
  size: number,
  reservedRows: Set<number>,
): void {
  const target = 8 + rng.int(5);
  let placed = 0;
  for (let guard = 0; placed < target && guard < 1000; guard++) {
    const x = rng.int(size);
    const y = rng.int(size);
    if (reservedRows.has(y)) {
      continue;
    }
    const current = tiles[y][x];
    if (current !== "plain" && current !== "forest" && current !== "hill") {
      continue;
    }
    tiles[y][x] = "rock";
    placed++;
  }
}
