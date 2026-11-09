import { describe, expect, it } from "vitest";
import { getConfig, toEngineConfig } from "../../config/config.js";
import { makeBriefSchema } from "./briefSchema.js";
import type { Brief } from "./briefSchema.js";
import { FALLBACK_BRIEF, FALLBACK_SEED } from "./fallback.js";
import { checkInvariants } from "./invariants.js";
import { materialize } from "./materialize.js";
import { placeArmies } from "./spawn.js";

const cfg = toEngineConfig(getConfig());

// Schema-valid briefs the materializer handles correctly for every seed —
// verified by the property test below.
const docBrief: Brief = {
  river: { startRow: 7, endRow: 6, bends: 2 },
  bridgeTiles: 2,
  forestZones: [
    { centerX: 5, centerY: 4, radius: 2 },
    { centerX: 9, centerY: 10, radius: 2 },
  ],
  hillZones: [{ centerX: 10, centerY: 3, radius: 1 }],
  lake: { centerX: 7, centerY: 7, radius: 1 },
};
const riverlessBrief: Brief = {
  river: null,
  bridgeTiles: 1, // ignored when river is null (03)
  forestZones: [{ centerX: 4, centerY: 4, radius: 3 }],
  hillZones: [
    { centerX: 8, centerY: 8, radius: 2 },
    { centerX: 3, centerY: 3, radius: 1 },
  ],
  lake: { centerX: 7, centerY: 9, radius: 2 },
};
const deepDiveBrief: Brief = {
  river: { startRow: 2, endRow: 12, bends: 3 },
  bridgeTiles: 2,
  forestZones: [{ centerX: 7, centerY: 7, radius: 2 }],
  hillZones: [{ centerX: 4, centerY: 3, radius: 2 }],
  lake: null,
};
const alwaysValidBriefs = [
  docBrief,
  riverlessBrief,
  deepDiveBrief,
  FALLBACK_BRIEF,
];

describe("materialize + invariants (03)", () => {
  it("every brief of the pool is schema-valid (the tests mean what they say)", () => {
    const schema = makeBriefSchema(cfg.boardSize);
    for (const brief of alwaysValidBriefs) {
      expect(schema.safeParse(brief).success).toBe(true);
    }
  });

  it("property: 40 fixed seeds × brief pool — all invariants hold", () => {
    for (let seed = 1; seed <= 40; seed++) {
      for (const brief of alwaysValidBriefs) {
        const board = materialize(brief, seed, cfg);
        const units = placeArmies(seed, cfg);
        expect(checkInvariants(board, brief, units, cfg)).toBeNull();
      }
    }
  });

  it("property: the river always reaches the opposite edge (left → right)", () => {
    for (let seed = 1; seed <= 40; seed++) {
      for (const brief of alwaysValidBriefs) {
        if (brief.river === null) {
          continue;
        }
        const board = materialize(brief, seed, cfg);
        const left = board.tiles.filter((row) => row[0] === "river").length;
        const right = board.tiles.filter(
          (row) => row[cfg.boardSize - 1] === "river",
        ).length;
        expect(left).toBe(1);
        expect(right).toBe(1);
      }
    }
  });

  it("bridges lie on the river and cross it (walkable path bank to bank)", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const board = materialize(docBrief, seed, cfg);
      const bridges: Array<[number, number]> = [];
      board.tiles.forEach((row, y) =>
        row.forEach((tile, x) => {
          if (tile === "bridge") {
            bridges.push([x, y]);
          }
        }),
      );
      expect(bridges).toHaveLength(docBrief.bridgeTiles);
      for (const [x, y] of bridges) {
        // the bridge keeps the path flowing: a horizontal stretch crosses
        // north-south, a vertical one east-west
        const horizontal =
          board.tiles[y][x - 1] === "river" &&
          board.tiles[y][x + 1] === "river";
        const vertical =
          board.tiles[y - 1][x] === "river" &&
          board.tiles[y + 1][x] === "river";
        expect(horizontal || vertical).toBe(true);
      }
    }
  });

  it("seeded snapshot: brief + fixed seed ⇒ the exact committed board", async () => {
    const board = materialize(docBrief, 42, cfg);
    await expect(JSON.stringify(board.tiles)).toMatchFileSnapshot(
      "./__snapshots__/doc-brief-seed-42.json",
    );
  });

  it("determinism: two runs of the same brief+seed produce identical boards", () => {
    const first = materialize(docBrief, 2026, cfg);
    const second = materialize(docBrief, 2026, cfg);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    // ...and a different seed produces a different board (the seed matters)
    const other = materialize(docBrief, 2027, cfg);
    expect(JSON.stringify(other)).not.toBe(JSON.stringify(first));
  });

  it("riverless brief: zero water beyond the lake, crossability holds, invariants 1-3 skipped", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const board = materialize(riverlessBrief, seed, cfg);
      let river = 0;
      let bridge = 0;
      let lake = 0;
      board.tiles.forEach((row) =>
        row.forEach((tile) => {
          if (tile === "river") river += 1;
          if (tile === "bridge") bridge += 1;
          if (tile === "lake") lake += 1;
        }),
      );
      expect(river).toBe(0);
      expect(bridge).toBe(0);
      expect(lake).toBeGreaterThan(0);
      expect(
        checkInvariants(board, riverlessBrief, placeArmies(seed, cfg), cfg),
      ).toBeNull();
    }
  });

  it("fallback template validates by construction", () => {
    const board = materialize(FALLBACK_BRIEF, FALLBACK_SEED, cfg);
    const units = placeArmies(FALLBACK_SEED, cfg);
    expect(checkInvariants(board, FALLBACK_BRIEF, units, cfg)).toBeNull();
  });
});
