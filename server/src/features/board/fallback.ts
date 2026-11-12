import type { BoardBrief } from "./briefSchema.js";

// Baseline fallback brief (8×8): riverless open field with small forest/hill/lake decoration,
// materialized with fixed seed `20261112` (docs/03).
export const FALLBACK_BRIEF: BoardBrief = {
  river: null,
  bridgeTiles: 1,
  forestZones: [{ centerX: 2, centerY: 2, radius: 1 }],
  hillZones: [{ centerX: 5, centerY: 3, radius: 1 }],
  lake: { centerX: 3, centerY: 3, radius: 1 },
};

export const FALLBACK_SEED = "20261112";
