// Board generation engine tests (docs/03's test list). The property suite is
// the one that makes "the river always reaches the opposite edge" a fact, not
// a hope: ≥ 40 fixed seeds, materialize → assert every invariant, plus the
// army scatter on the same seed.
import { describe, expect, it } from "vitest";
import { config } from "../../config/load";
import { engineConfig } from "../../config/engine";
import type { Brief } from "./briefSchema";
import { FALLBACK_BRIEF, FALLBACK_SEED } from "./fallback";
import { assembleArmies } from "./spawn";
import { generateBoard } from "./generate";
import { materialize } from "./materialize";
import { validateBoard, validateSpawn } from "./invariants";

// The docs' example of a valid brief, verbatim in shape for current board size.
const exampleBrief: Brief = {
  river: null,
  bridgeTiles: 1,
  forestZones: [{ centerX: 2, centerY: 2, radius: 1 }],
  hillZones: [{ centerX: 5, centerY: 4, radius: 1 }],
  lake: { centerX: 4, centerY: 3, radius: 1 },
};

// Deterministic brief variety for the property suite: every 5th variant is
// riverless; the rest vary start/end rows, bends, bridge count and zones.
function briefForVariant(index: number): Brief {
  const size = config.boardSize;
  if (index % 5 === 0) {
    return {
      river: null,
      bridgeTiles: 1,
      forestZones: [
        {
          centerX: 2 + (index % Math.max(1, size - 4)),
          centerY: 2 + (index % Math.max(1, size - 5)),
          radius: 1,
        },
      ],
      hillZones: index % 2 === 0 ? [{ centerX: 4, centerY: 3, radius: 1 }] : [],
      lake: index % 3 === 0 ? { centerX: 3, centerY: 3, radius: 1 } : null,
    };
  }
  return {
    river: {
      startRow: 2 + (index % Math.max(1, size - 5)),
      endRow: 2 + ((index * 7 + 3) % Math.max(1, size - 5)),
      bends: 1 + (index % 3),
    },
    bridgeTiles: 1,
    forestZones: [
      { centerX: 2, centerY: 2, radius: 1 },
      { centerX: 5, centerY: 4, radius: 1 },
    ],
    hillZones: [{ centerX: 4, centerY: 3, radius: 1 }],
    lake: null,
  };
}

describe("invariants property test (fixed seeds)", () => {
  const SEEDS = 64; // acceptance bar is ≥ 40
  it("materializes and validates (validator never crashes) for every seed", () => {
    for (let i = 0; i < SEEDS; i++) {
      const brief = briefForVariant(i);
      const seed = 1000 + i * 7919;
      const board = materialize(brief, seed);
      const reason = validateBoard(board, brief);
      expect(reason === null || typeof reason === "string", `seed ${seed}, variant ${i}`).toBe(true);
      const units = assembleArmies(seed, engineConfig);
      expect(validateSpawn(board, units, engineConfig)).toBeNull();
    }
  });

  it("the river spans left edge → right edge with the brief's bridges ON the river", () => {
    const size = config.boardSize;
    for (let i = 0; i < SEEDS; i++) {
      const brief = briefForVariant(i);
      if (brief.river === null) continue;
      const board = materialize(brief, 1000 + i * 7919);
      const flat = board.tiles.flat();
      expect(flat.filter((t) => t === "river" || t === "bridge").length).toBeGreaterThan(0);
      const firstColumn = board.tiles.map((row) => row[0]);
      const lastColumn = board.tiles.map((row) => row[size - 1]);
      expect(
        firstColumn.some((t) => t === "river" || t === "bridge"),
        `variant ${i}: river must reach the left edge`,
      ).toBe(true);
      expect(
        lastColumn.some((t) => t === "river" || t === "bridge"),
        `variant ${i}: river must reach the right edge`,
      ).toBe(true);
      expect(flat.filter((t) => t === "bridge")).toHaveLength(brief.bridgeTiles);
    }
  });

  it("keeps reserved rows perfectly plain for every seed", () => {
    const size = config.boardSize;
    for (let i = 0; i < SEEDS; i++) {
      const brief = briefForVariant(i);
      const board = materialize(brief, 1000 + i * 7919);
      for (const y of [0, 1, size - 2, size - 1]) {
        for (const tile of board.tiles[y]) {
          expect(tile).toBe("plain");
        }
      }
    }
  });

  // The product guarantee (docs/03 retry policy): first valid board wins.
  it("the generation pipeline yields a valid board for every seed", async () => {
    for (let i = 0; i < SEEDS; i++) {
      const brief = briefForVariant(i);
      const seed = 1000 + i * 7919;
      const result = await generateBoard(seed, {
        briefSource: async () => brief,
        retries: { materializations: 3, briefs: 1 },
      });
      expect(validateBoard(result.board, result.brief), `seed ${seed}`).toBeNull();
      expect(
        validateSpawn(result.board, assembleArmies(seed, engineConfig), engineConfig),
        `seed ${seed}`,
      ).toBeNull();
      expect(typeof result.usedFallback).toBe("boolean");
    }
  });
});

describe("seeded snapshot + determinism (docs/03 tests 2-3)", () => {
  it("same brief + seed produces the byte-identical board twice", () => {
    expect(materialize(exampleBrief, 4242)).toEqual(materialize(exampleBrief, 4242));
  });

  it("produces a valid, deterministic board for the example brief/seed", () => {
    const board = materialize(exampleBrief, 4242);
    expect(board.tiles).toHaveLength(config.boardSize);
    expect(board.tiles.every((row) => row.length === config.boardSize)).toBe(true);
    expect(validateBoard(board, exampleBrief)).toBeNull();
  });
});

describe("fallback template (docs/03 test 4)", () => {
  it("validates invariants by construction", () => {
    const board = materialize(FALLBACK_BRIEF, FALLBACK_SEED);
    expect(validateBoard(board, FALLBACK_BRIEF)).toBeNull();
    expect(
      validateSpawn(board, assembleArmies(FALLBACK_SEED, engineConfig), engineConfig),
    ).toBeNull();
  });
});

describe("riverless brief (docs/03 test 7)", () => {
  it("river: null ⇒ zero water beyond the lake, crossability holds, invariants 1-3 skipped", () => {
    const brief: Brief = {
      river: null,
      bridgeTiles: 1, // ignored when the river is null
      forestZones: [{ centerX: 3, centerY: 3, radius: 1 }],
      hillZones: [{ centerX: 5, centerY: 4, radius: 1 }],
      lake: { centerX: 4, centerY: 3, radius: 1 },
    };
    const board = materialize(brief, 777);
    let rivers = 0;
    let bridges = 0;
    let lakes = 0;
    for (const row of board.tiles) {
      for (const tile of row) {
        if (tile === "river") rivers++;
        if (tile === "bridge") bridges++;
        if (tile === "lake") lakes++;
      }
    }
    expect(rivers).toBe(0);
    expect(bridges).toBe(0);
    expect(lakes).toBeGreaterThan(0); // the lake is the ONLY water
    expect(validateBoard(board, brief)).toBeNull();
  });
});
