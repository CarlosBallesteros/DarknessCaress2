import type { BoardBrief } from "./briefSchema";

export const FALLBACK_BRIEF: BoardBrief = {
  river: null,
  bridgeTiles: 1,
  forestZones: [
    { centerX: 2, centerY: 2, radius: 1 },
    { centerX: 5, centerY: 3, radius: 1 },
  ],
  hillZones: [{ centerX: 4, centerY: 3, radius: 1 }],
  lake: { centerX: 3, centerY: 3, radius: 1 },
};

export const FALLBACK_SEED = "20261112";
