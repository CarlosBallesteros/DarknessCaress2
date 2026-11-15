// Committed fixture JSON for the mock LLM client (docs/04, 09 phase 4).
export const briefFixture = {
  river: {
    startRow: 3,
    endRow: 4,
    bends: 2,
  },
  bridgeTiles: 1,
  forestZones: [{ centerX: 2, centerY: 2, radius: 1 }],
  hillZones: [{ centerX: 5, centerY: 3, radius: 1 }],
  lake: { centerX: 3, centerY: 3, radius: 1 },
} as const;
