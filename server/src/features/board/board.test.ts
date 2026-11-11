// Board generation engine tests (docs/03's test list). The property suite is
// the one that makes "the river always reaches the opposite edge" a fact, not
// a hope: ≥ 40 fixed seeds, materialize → assert every invariant, plus the
// army scatter on the same seed.
import { describe, expect, it } from "vitest";
import { engineConfig } from "../../game/engine-config";
import type { Brief } from "./brief-schema";
import { FALLBACK_BRIEF, FALLBACK_SEED } from "./fallback";
import { assembleArmies } from "./spawn";
import { generateBoard } from "./generate";
import { materialize } from "./materialize";
import { validateBoard, validateSpawn } from "./invariants";

// The docs' example of a valid brief, verbatim.
const exampleBrief: Brief = {
  river: { startRow: 7, endRow: 6, bends: 2 },
  bridgeTiles: 2,
  forestZones: [
    { centerX: 5, centerY: 4, radius: 2 },
    { centerX: 9, centerY: 10, radius: 2 },
  ],
  hillZones: [{ centerX: 10, centerY: 3, radius: 1 }],
  lake: { centerX: 7, centerY: 7, radius: 1 },
};

// Deterministic brief variety for the property suite: every 5th variant is
// riverless; the rest vary start/end rows, bends, bridge count and zones —
// all within the documented schema ranges.
function briefForVariant(index: number): Brief {
  if (index % 5 === 0) {
    return {
      river: null,
      bridgeTiles: 2,
      forestZones: [
        {
          centerX: 3 + (index % 7),
          centerY: 4 + (index % 6),
          radius: 1 + (index % 3),
        },
      ],
      hillZones: index % 2 === 0 ? [{ centerX: 9, centerY: 3, radius: 1 }] : [],
      lake: index % 3 === 0 ? { centerX: 7, centerY: 7, radius: 1 } : null,
    };
  }
  return {
    river: {
      startRow: 2 + (index % 11),
      endRow: 2 + ((index * 7 + 3) % 11),
      bends: 1 + (index % 3),
    },
    bridgeTiles: 1 + (index % 2),
    forestZones: [
      { centerX: 4, centerY: 3, radius: 2 },
      { centerX: 9 + (index % 3), centerY: 10, radius: 1 },
    ],
    hillZones: [{ centerX: 10, centerY: 2 + (index % 3), radius: 1 }],
    lake: null,
  };
}

describe("invariants property test (fixed seeds)", () => {
  const SEEDS = 64; // acceptance bar is ≥ 40
  it("materializes a fully valid board (and valid spawn scatter) for every seed", () => {
    for (let i = 0; i < SEEDS; i++) {
      const brief = briefForVariant(i);
      const seed = 1000 + i * 7919;
      const board = materialize(brief, seed);
      expect(
        validateBoard(board, brief),
        `seed ${seed}, variant ${i}`,
      ).toBeNull();
      const units = assembleArmies(seed, engineConfig);
      expect(
        validateSpawn(board, units, engineConfig),
        `seed ${seed}, variant ${i}`,
      ).toBeNull();
    }
  });

  it("keeps reserved rows perfectly plain for every seed", () => {
    for (let i = 0; i < SEEDS; i++) {
      const brief = briefForVariant(i);
      const board = materialize(brief, 1000 + i * 7919);
      for (const y of [0, 1, 13, 14]) {
        for (const tile of board.tiles[y]) {
          expect(tile).toBe("plain");
        }
      }
    }
  });

  // The product guarantee (docs/03 retry policy): first valid board wins.
  // Deterministic per seed — the same seed repeats the same attempts — so a
  // rare invalid single materialization is retried, never shipped.
  it("the generation pipeline yields a valid board for every seed", async () => {
    for (let i = 0; i < SEEDS; i++) {
      const brief = briefForVariant(i);
      const seed = 1000 + i * 7919;
      const result = await generateBoard(seed, {
        briefSource: async () => brief,
        retries: { materializations: 3, briefs: 1 },
      });
      expect(
        validateBoard(result.board, result.brief),
        `seed ${seed}`,
      ).toBeNull();
      expect(
        validateSpawn(
          result.board,
          assembleArmies(seed, engineConfig),
          engineConfig,
        ),
        `seed ${seed}`,
      ).toBeNull();
    }
  });
});

describe("seeded snapshot + determinism (docs/03 tests 2-3)", () => {
  it("same brief + seed produces the byte-identical board twice", () => {
    expect(materialize(exampleBrief, 4242)).toEqual(
      materialize(exampleBrief, 4242),
    );
  });

  it("matches the committed golden board (regression on determinism)", () => {
    const board = materialize(exampleBrief, 4242);
    expect(board.tiles.map((row) => row.join(","))).toMatchInlineSnapshot(`
      [
        "plain,plain,plain,plain,plain,plain,plain,plain,plain,plain,plain,plain,plain,plain,plain",
        "plain,plain,plain,plain,plain,plain,plain,plain,plain,plain,plain,plain,plain,plain,plain",
        "plain,rock,plain,plain,plain,forest,plain,plain,plain,plain,hill,plain,plain,plain,plain",
        "plain,plain,plain,plain,forest,forest,forest,plain,plain,hill,hill,hill,plain,plain,plain",
        "plain,plain,plain,forest,forest,forest,forest,forest,plain,plain,hill,plain,plain,plain,plain",
        "plain,plain,plain,plain,forest,forest,forest,plain,plain,plain,plain,plain,plain,plain,rock",
        "plain,plain,rock,plain,plain,forest,plain,lake,plain,plain,plain,plain,river,river,river",
        "river,river,plain,plain,plain,plain,lake,lake,lake,plain,plain,plain,river,plain,plain",
        "plain,river,river,river,bridge,river,river,river,river,forest,plain,plain,river,plain,plain",
        "plain,plain,plain,rock,plain,plain,plain,plain,river,forest,rock,rock,river,plain,plain",
        "plain,plain,plain,plain,plain,plain,plain,rock,river,river,forest,river,river,plain,plain",
        "plain,plain,plain,plain,plain,rock,plain,plain,forest,river,forest,river,rock,plain,plain",
        "plain,plain,plain,rock,rock,plain,plain,plain,plain,river,bridge,river,plain,plain,plain",
        "plain,plain,plain,plain,plain,plain,plain,plain,plain,plain,plain,plain,plain,plain,plain",
        "plain,plain,plain,plain,plain,plain,plain,plain,plain,plain,plain,plain,plain,plain,plain",
      ]
    `);
  });
});

describe("fallback template (docs/03 test 4)", () => {
  it("validates invariants by construction", () => {
    const board = materialize(FALLBACK_BRIEF, FALLBACK_SEED);
    expect(validateBoard(board, FALLBACK_BRIEF)).toBeNull();
    expect(
      validateSpawn(
        board,
        assembleArmies(FALLBACK_SEED, engineConfig),
        engineConfig,
      ),
    ).toBeNull();
  });
});

describe("riverless brief (docs/03 test 7)", () => {
  it("river: null ⇒ zero water beyond the lake, crossability holds, invariants 1-3 skipped", () => {
    const brief: Brief = {
      river: null,
      bridgeTiles: 2, // ignored when the river is null
      forestZones: [{ centerX: 5, centerY: 4, radius: 2 }],
      hillZones: [{ centerX: 10, centerY: 3, radius: 1 }],
      lake: { centerX: 7, centerY: 7, radius: 1 },
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
    // Crossability (invariant 4) runs on every board — on a riverless field
    // it must hold without any bridge.
    expect(validateBoard(board, brief)).toBeNull();
  });
});
