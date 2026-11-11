// Retry policy tests (docs/03): the budget comes from config
// (config.ai.boardRetries) — a test config with materializations: 1 stops
// after one attempt per brief → regenerates → fallback, proving no hardcoded
// budget. The materializer is sabotaged for LIVE attempts only (a lake
// covering the board fails validation deterministically); the fallback
// materialization keeps its real result so the policy's fallback branch runs.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../../config/load";
import { FALLBACK_SEED } from "./fallback";

const { sabotagedSeeds, sabotageEnabled } = vi.hoisted(() => ({
  sabotagedSeeds: [] as number[],
  sabotageEnabled: { value: true },
}));

vi.mock("./materialize", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./materialize")>();
  return {
    ...actual,
    materialize: (brief: Parameters<typeof actual.materialize>[0], seed: number) => {
      const board = actual.materialize(brief, seed);
      if (seed !== FALLBACK_SEED && sabotageEnabled.value) {
        sabotagedSeeds.push(seed);
        for (const row of board.tiles) row.fill("lake");
      }
      return board;
    },
  };
});

import { generateBoard } from "./generate";

const alwaysSameBrief = () => async () => ({
  river: { startRow: 7, endRow: 6, bends: 2 },
  bridgeTiles: 2,
  forestZones: [{ centerX: 5, centerY: 4, radius: 2 }],
  hillZones: [],
  lake: null,
});

beforeEach(() => {
  sabotagedSeeds.length = 0;
  sabotageEnabled.value = true;
});

describe("board retry policy", () => {
  it("honors materializations: 1 — one attempt per brief, then regenerate, then fallback", async () => {
    const briefSource = vi.fn(alwaysSameBrief());
    const result = await generateBoard(12345, {
      briefSource,
      retries: { materializations: 1, briefs: 2 },
    });
    expect(briefSource).toHaveBeenCalledTimes(2); // ≤ briefs total
    expect(sabotagedSeeds).toHaveLength(2); // exactly ONE materialization per brief
    expect(result.usedFallback).toBe(true);
    expect(result.brief.river).not.toBeNull(); // result is the fallback brief
  });

  it("honors materializations: 3 with briefs: 1 — three attempts on the single brief", async () => {
    const briefSource = vi.fn(alwaysSameBrief());
    const result = await generateBoard(12345, {
      briefSource,
      retries: { materializations: 3, briefs: 1 },
    });
    expect(briefSource).toHaveBeenCalledTimes(1);
    expect(sabotagedSeeds).toHaveLength(3);
    expect(result.usedFallback).toBe(true);
  });

  it("accepts the first valid materialization without burning the budget", async () => {
    sabotageEnabled.value = false;
    const briefSource = vi.fn(alwaysSameBrief());
    const result = await generateBoard(12345, {
      briefSource,
      retries: { materializations: 3, briefs: 3 },
    });
    expect(briefSource).toHaveBeenCalledTimes(1);
    expect(sabotagedSeeds).toHaveLength(0);
    expect(result.usedFallback).toBe(false);
  });

  it("schema-invalid briefs consume the briefs budget, then fall back", async () => {
    const briefSource = vi.fn(async () => ({ nope: true }));
    const result = await generateBoard(12345, {
      briefSource,
      retries: { materializations: 3, briefs: 2 },
    });
    expect(briefSource).toHaveBeenCalledTimes(2);
    expect(sabotagedSeeds).toHaveLength(0);
    expect(result.usedFallback).toBe(true);
  });

  it("an unreachable LLM (briefSource throws) falls back instead of crashing", async () => {
    const briefSource = vi.fn(async () => {
      throw new Error("Ollama is unreachable");
    });
    const result = await generateBoard(12345, {
      briefSource,
      retries: { materializations: 3, briefs: 3 },
    });
    expect(briefSource).toHaveBeenCalledTimes(3);
    expect(result.usedFallback).toBe(true);
  });

  it("with no injected retries, the budget is exactly config.ai.boardRetries", async () => {
    const briefSource = vi.fn(async () => ({ nope: true })); // every brief invalid
    const result = await generateBoard(12345, { briefSource });
    expect(briefSource).toHaveBeenCalledTimes(config.ai.boardRetries.briefs);
    expect(result.usedFallback).toBe(true);
  });

  it("the pipeline result carries both armies, freshly spawned", async () => {
    sabotageEnabled.value = false;
    const result = await generateBoard(12345, { briefSource: alwaysSameBrief() });
    expect(result.units).toHaveLength(20);
    for (const unit of result.units) {
      expect(unit.hp).toBe(unit.maxHp);
      expect(unit.acted).toBe(false);
    }
  });
});
