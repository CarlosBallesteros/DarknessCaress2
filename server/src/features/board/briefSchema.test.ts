// Stage 1 contract tests (docs/03): the brief schema rejects extras and
// out-of-range values; the prompt template renders every board-size-derived
// number from config at build time (docs/04 prompt hygiene — mutate nothing
// by hand).
import { describe, expect, it } from "vitest";
import { config } from "../../config/load";
import { briefJsonSchema, briefSchema, type Brief } from "./briefSchema";
import { briefPrompt } from "./briefPrompt";

const validBrief: Brief = {
  river: { startRow: 7, endRow: 6, bends: 2 },
  bridgeTiles: 2,
  forestZones: [{ centerX: 5, centerY: 4, radius: 2 }],
  hillZones: [{ centerX: 10, centerY: 3, radius: 1 }],
  lake: { centerX: 7, centerY: 7, radius: 1 },
};

describe("briefSchema", () => {
  it("accepts the documented example", () => {
    expect(briefSchema.safeParse(validBrief).success).toBe(true);
  });

  it("rejects extra keys (extras rejected)", () => {
    expect(briefSchema.safeParse({ ...validBrief, surprise: 1 }).success).toBe(false);
  });

  it("enforces the documented ranges (baseline bounds)", () => {
    const outOfRange: Brief = {
      ...validBrief,
      river: { startRow: 13, endRow: 6, bends: 2 }, // startRow must be 2-12
    };
    expect(briefSchema.safeParse(outOfRange).success).toBe(false);

    const badBends: Brief = { ...validBrief, river: { startRow: 7, endRow: 6, bends: 4 } };
    expect(briefSchema.safeParse(badBends).success).toBe(false);

    const badRadius: Brief = {
      ...validBrief,
      lake: { centerX: 7, centerY: 7, radius: 3 },
    };
    expect(briefSchema.safeParse(badRadius).success).toBe(false);

    const noForest: Brief = { ...validBrief, forestZones: [] };
    expect(briefSchema.safeParse(noForest).success).toBe(false);

    const threeHills: Brief = {
      ...validBrief,
      hillZones: [
        { centerX: 3, centerY: 3, radius: 1 },
        { centerX: 5, centerY: 5, radius: 1 },
        { centerX: 7, centerY: 7, radius: 1 },
      ],
    };
    expect(briefSchema.safeParse(threeHills).success).toBe(false);

    const badBridgeCount: Brief = { ...validBrief, bridgeTiles: 3 };
    expect(briefSchema.safeParse(badBridgeCount).success).toBe(false);
  });
});

describe("briefJsonSchema (Ollama `format` grammar, docs/04)", () => {
  it("mirrors the zod schema's shape", () => {
    expect(briefJsonSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["river", "bridgeTiles", "forestZones", "hillZones", "lake"],
    });
    expect(briefJsonSchema.properties.forestZones).toMatchObject({
      minItems: 1,
      maxItems: 3,
    });
  });
});

describe("briefPrompt (docs/03 template)", () => {
  it("renders every board-size-derived number from config", () => {
    const prompt = briefPrompt();
    const size = config.boardSize;
    expect(prompt).toContain(`a ${size}x${size} grid`);
    expect(prompt).toContain(`BOTTOM rows (${size - 2}-${size - 1})`);
    expect(prompt).toContain(`TOP rows (0-1)`);
    expect(prompt).toContain(`"startRow": int 2-${size - 3}`); // river rows
    expect(prompt).toContain(`"centerY": int 3-${size - 4}`); // lake rows
    expect(prompt).toContain(`"radius": int 1-3`); // forest zones
    expect(prompt).toContain(`"radius": int 1-2`); // hill zones + lake
    expect(prompt).toContain(`"bends": int 1-3`);
    expect(prompt).toContain('"bridgeTiles": <integer 1 or 2');
  });
});
