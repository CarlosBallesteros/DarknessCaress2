import type { Brief } from "./briefSchema.js";

/**
 * 03's fallback: when every brief of the budget fails (LLM degraded/offline or
 * all materializations invalid), this committed constant is materialized by
 * the same seeded pipeline with the fixed seed below — fully deterministic.
 * Not a gameplay heuristic: a deterministic backup brief through the normal
 * pipeline, recorded in the game row as used_fallback = true.
 */
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
