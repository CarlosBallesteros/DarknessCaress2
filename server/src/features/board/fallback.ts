// The fallback board (docs/03 retry policy step 3): a committed constant
// brief, materialized by the same seeded pipeline with the same fixed seed —
// fully deterministic. Not a gameplay heuristic: a deterministic backup brief
// through the normal pipeline, recorded in the game row as used_fallback.
import type { Brief } from "./briefSchema";

export const FALLBACK_BRIEF: Brief = {
  river: null,
  bridgeTiles: 1,
  forestZones: [{ centerX: 2, centerY: 2, radius: 1 }],
  hillZones: [{ centerX: 5, centerY: 4, radius: 1 }],
  lake: { centerX: 4, centerY: 3, radius: 1 },
};

export const FALLBACK_SEED = 20261112;
