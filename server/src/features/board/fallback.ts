// The fallback board (docs/03 retry policy step 3): a committed constant
// brief, materialized by the same seeded pipeline with the same fixed seed —
// fully deterministic. Not a gameplay heuristic: a deterministic backup brief
// through the normal pipeline, recorded in the game row as used_fallback.
import type { Brief } from "./briefSchema";

export const FALLBACK_BRIEF: Brief = {
  river: { startRow: 7, endRow: 7, bends: 2 },
  bridgeTiles: 2,
  forestZones: [
    { centerX: 4, centerY: 3, radius: 2 },
    { centerX: 10, centerY: 10, radius: 2 },
  ],
  hillZones: [{ centerX: 11, centerY: 2, radius: 1 }],
  lake: null,
};

export const FALLBACK_SEED = 20261108;
