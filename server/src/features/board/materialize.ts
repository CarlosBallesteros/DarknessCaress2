// Stage 2 of board generation (docs/03): deterministic materialization of a
// validated brief into a real board. The SAME brief + seed always produces the
// SAME board. Algorithm order is exactly the doc's: grid init → river →
// bridges → lake → forest/hill zones → rocks → reserved rows forced plain.
import { config } from "../../config/config";
import type { Board, Tile } from "../../game/types";
import type { Brief } from "./brief-schema";
import { mulberry32 } from "./prng";

// Spawn-block width (docs/03): each army occupies an 8×2 block. Structural
// spec constant, not a balance stat.
export const SPAWN_BLOCK_COLUMNS = 8;

export function isReservedRow(y: number, size: number): boolean {
  return y <= 1 || y >= size - 2;
}

export function spawnBlockStartColumn(size: number): number {
  return Math.ceil((size - SPAWN_BLOCK_COLUMNS) / 2); // 4 at the 15×15 baseline
}

export function materialize(brief: Brief, seed: number): Board {
  const size = config.boardSize;
  const rng = mulberry32(seed);
  const tiles: Tile[][] = Array.from({ length: size }, () =>
    Array<Tile>(size).fill("plain"),
  );

  if (brief.river) {
    carveRiver(tiles, size, brief.river, rng);
    placeBridges(tiles, size, brief.bridgeTiles, brief.lake, rng);
  }
  if (brief.lake) {
    paintBlob(tiles, size, brief.lake, "lake");
  }
  for (const zone of brief.forestZones) {
    paintBlob(tiles, size, zone, "forest");
  }
  for (const zone of brief.hillZones) {
    paintBlob(tiles, size, zone, "hill");
  }
  sprinkleRocks(tiles, size, rng);
  forceReservedRowsPlain(tiles, size);

  return { tiles };
}

// Carve the river as a 4-connected simple path from (0, startRow) to
// (size-1, endRow): a seeded walk that prefers right, sidesteps toward each
// segment's target row in short bounded vertical runs, and reaches the right
// edge HORIZONTALLY — a run in the final column would give the edge tile two
// path neighbours and break the simple-path invariant.
function carveRiver(
  tiles: Tile[][],
  size: number,
  river: NonNullable<Brief["river"]>,
  rng: () => number,
): void {
  const minRow = 2;
  const maxRow = size - 3;
  const last = size - 1;
  const segments = splitSegments(last, river.bends + 1);

  let y = river.startRow;
  tiles[y][0] = "river";
  // Step right out of column 0 so the path is continuous from the edge; the
  // segments then cover columns 1..last.
  tiles[y][1] = "river";
  // Row range of the PREVIOUS column's tiles: a vertical step into that range
  // would touch the path a column over (self-touching) — the walk avoids it,
  // and the invariants validator remains the final guarantee (docs/03).
  let prevMin = y;
  let prevMax = y;

  segments.forEach((segment, segmentIndex) => {
    const isLastSegment = segmentIndex === segments.length - 1;
    const segmentLength = segment.to - segment.from + 1;
    // The final segment's target is the HARD endRow (never clamped — the
    // river must land exactly there); the others are soft steering targets,
    // clamped so their climb stays reachable within the segment's columns.
    let target = isLastSegment
      ? river.endRow
      : minRow + Math.floor(rng() * (maxRow - minRow + 1));
    if (!isLastSegment) {
      target = Math.max(
        Math.max(minRow, y - segmentLength),
        Math.min(Math.min(maxRow, y + segmentLength), target),
      );
    }

    for (let x = segment.from; x <= segment.to; x++) {
      const entryY = y;
      const dist = Math.abs(target - y);
      if (dist > 0) {
        const dir = Math.sign(target - y);
        if (x === last - 2) {
          // Forced alignment attempt: cover the full remaining distance here,
          // because the entry into the right edge must be horizontal (a run
          // at the edge column would leave the edge tile with two path
          // neighbours). Same-direction runs are always self-touch-free; a
          // blocked reversal near the edge gives up alignment rather than
          // writing an illegal tile — the board stays legal either way (the
          // validator, not the walk, is the guarantee).
          for (let step = 0; step < dist; step++) {
            const next = y + dir;
            if (next < minRow || next > maxRow) break;
            if (next >= prevMin && next <= prevMax) break;
            y = next;
            tiles[y][x] = "river";
          }
        } else if (x < last - 1 && rng() < 0.5) {
          // Preferred shape: a short bounded run (≤ 2) toward the target.
          const steps = Math.min(dist, 2);
          for (let step = 0; step < steps; step++) {
            const next = y + dir;
            if (next < minRow || next > maxRow) break;
            if (next >= prevMin && next <= prevMax) break; // self-touch guard
            y = next;
            tiles[y][x] = "river";
          }
        }
      }
      if (x < last) {
        // A rightward move is always available — the walk always terminates.
        tiles[y][x + 1] = "river";
        prevMin = Math.min(entryY, y);
        prevMax = Math.max(entryY, y);
      }
    }
  });
}

// bends + 1 contiguous segments over columns 1..last (docs/03: the bends split
// the columns into bends + 1 segments).
function splitSegments(
  last: number,
  segmentCount: number,
): Array<{ from: number; to: number }> {
  const columns = last; // columns 1..last
  const segments: Array<{ from: number; to: number }> = [];
  const base = Math.floor(columns / segmentCount);
  let remainder = columns % segmentCount;
  let from = 1;
  for (let i = 0; i < segmentCount; i++) {
    const length = base + (remainder > 0 ? 1 : 0);
    remainder--;
    segments.push({ from, to: from + length - 1 });
    from += length;
  }
  return segments;
}

// Pick bridgeTiles positions from the river tiles: 2 → first/third quarter of
// width by column; 1 → middle. Chosen river tiles become walkable bridge.
// A crossing only WORKS where the river flows horizontally: both vertical
// neighbours of the bridge must stay non-water so armies can step on from
// north and south (a bridge on a vertical run is unreachable and cuts the
// map in two). The brief's lake is known before painting — candidates whose
// vertical neighbours fall inside the lake blob are excluded too, so the
// later lake can never wall off a bridge. Every river column has at least
// one such tile (the far end of any vertical run, or a runless tile).
function placeBridges(
  tiles: Tile[][],
  size: number,
  bridgeTiles: Brief["bridgeTiles"],
  lake: Brief["lake"],
  rng: () => number,
): void {
  const inLakeBlob = (x: number, y: number): boolean =>
    lake !== null &&
    (x - lake.centerX) ** 2 + (y - lake.centerY) ** 2 <= lake.radius ** 2;
  const byColumn = new Map<number, Array<[number, number]>>();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (tiles[y][x] !== "river") continue;
      const north = y > 0 ? tiles[y - 1][x] : "plain";
      const south = y < size - 1 ? tiles[y + 1][x] : "plain";
      if (north === "river" || south === "river") continue; // vertical run tile
      if (inLakeBlob(x, y - 1) || inLakeBlob(x, y + 1)) continue;
      const list = byColumn.get(x) ?? [];
      list.push([x, y]);
      byColumn.set(x, list);
    }
  }

  const pick = (targetColumn: number): [number, number] => {
    for (let offset = 0; offset < size; offset++) {
      const candidates =
        offset === 0
          ? [targetColumn]
          : [targetColumn - offset, targetColumn + offset];
      for (const column of candidates) {
        const list = byColumn.get(column);
        if (list && list.length > 0) {
          return list[Math.floor(rng() * list.length)];
        }
      }
    }
    throw new Error("materializer bug: no crossable river tile for a bridge");
  };

  const middle = Math.round((size - 1) / 2);
  const chosen =
    bridgeTiles === 1
      ? [pick(middle)]
      : [
          pick(Math.round((size - 1) * 0.25)),
          pick(Math.round((size - 1) * 0.75)),
        ];
  for (const [x, y] of chosen) {
    tiles[y][x] = "bridge";
  }
}

// Classic (dx²+dy²) ≤ r² blob mask. Lake skips river/bridge/reserved rows
// (docs/03 step 4); zones additionally skip lake/rock (step 5).
function paintBlob(
  tiles: Tile[][],
  size: number,
  zone: { centerX: number; centerY: number; radius: number },
  target: Tile,
): void {
  for (let dy = -zone.radius; dy <= zone.radius; dy++) {
    for (let dx = -zone.radius; dx <= zone.radius; dx++) {
      if (dx * dx + dy * dy > zone.radius * zone.radius) continue;
      const x = zone.centerX + dx;
      const y = zone.centerY + dy;
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const current = tiles[y][x];
      if (
        current === "river" ||
        current === "bridge" ||
        isReservedRow(y, size)
      ) {
        continue;
      }
      if (target !== "lake" && (current === "lake" || current === "rock")) {
        continue;
      }
      tiles[y][x] = target;
    }
  }
}

// Purely cosmetic rocks: seeded, ~8-12 of them, skipping water and reserved
// rows. A rock must never replace a bridge — bridges are the only crossings.
function sprinkleRocks(tiles: Tile[][], size: number, rng: () => number): void {
  const targetCount = 8 + Math.floor(rng() * 5);
  const placed = new Set<string>();
  let guard = 0;
  while (placed.size < targetCount && guard++ < 500) {
    const x = Math.floor(rng() * size);
    const y = Math.floor(rng() * size);
    const key = `${x},${y}`;
    if (placed.has(key)) continue;
    const tile = tiles[y][x];
    if (
      tile === "lake" ||
      tile === "river" ||
      tile === "bridge" ||
      isReservedRow(y, size)
    ) {
      continue;
    }
    placed.add(key);
    tiles[y][x] = "rock";
  }
}

// Spawn safety is absolute (docs/03 step 7): reserved rows overwrite
// everything placed above.
function forceReservedRowsPlain(tiles: Tile[][], size: number): void {
  for (let y = 0; y < size; y++) {
    if (!isReservedRow(y, size)) continue;
    for (let x = 0; x < size; x++) {
      tiles[y][x] = "plain";
    }
  }
}
