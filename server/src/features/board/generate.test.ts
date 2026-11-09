import { describe, expect, it } from "vitest";
import { getConfig, toEngineConfig } from "../../config/config.js";
import type { AppConfig } from "../../config/config.js";
import { makeBriefSchema } from "./briefSchema.js";
import type { Brief } from "./briefSchema.js";
import { FALLBACK_BRIEF, FALLBACK_SEED } from "./fallback.js";
import { generateGame, BoardGenerationError } from "./generate.js";
import { checkInvariants } from "./invariants.js";
import { LlmError } from "../ai/llmClient.js";
import type { LlmClient } from "../ai/llmClient.js";
import { materialize } from "./materialize.js";
import { placeArmies } from "./spawn.js";

const appConfig = getConfig();
const engineCfg = toEngineConfig(appConfig);

// A schema-valid brief whose materialization ALWAYS fails invariant 4: the
// single bridge lands mid-board and the lake walls off its near bank, so no
// walkable path connects the spawn sides — a "bad brief" per 03, handled by
// regeneration and (at budget exhaustion) the fallback template.
const uncrossableBrief: Brief = {
  river: { startRow: 7, endRow: 7, bends: 1 },
  bridgeTiles: 1,
  forestZones: [{ centerX: 3, centerY: 11, radius: 1 }],
  hillZones: [],
  lake: { centerX: 7, centerY: 5, radius: 2 },
};
// This one fails for SOME materialization seeds and succeeds for others:
// seed 10 is walled off, seed 11 is crossable (verified exhaustively).
const seedSensitiveBrief: Brief = {
  river: { startRow: 3, endRow: 11, bends: 2 },
  bridgeTiles: 1,
  forestZones: [{ centerX: 10, centerY: 10, radius: 2 }],
  hillZones: [],
  lake: { centerX: 4, centerY: 4, radius: 2 },
};
const goodBrief: Brief = {
  river: { startRow: 7, endRow: 6, bends: 2 },
  bridgeTiles: 2,
  forestZones: [
    { centerX: 5, centerY: 4, radius: 2 },
    { centerX: 9, centerY: 10, radius: 2 },
  ],
  hillZones: [{ centerX: 10, centerY: 3, radius: 1 }],
  lake: { centerX: 7, centerY: 7, radius: 1 },
};

const THROW = Symbol("llm unreachable");

/** Queued brief() responses; the last entry repeats; THROW rejects like a dead Ollama. */
class QueuedLlm implements LlmClient {
  calls = 0;
  constructor(private readonly queue: unknown[]) {}
  async brief(): Promise<unknown> {
    const next = this.queue[Math.min(this.calls, this.queue.length - 1)];
    this.calls += 1;
    if (next === THROW) {
      throw new LlmError("Ollama is unreachable");
    }
    return next;
  }
  async chat(): Promise<unknown> {
    throw new LlmError("phase 5");
  }
  async turn(): Promise<unknown> {
    throw new LlmError("phase 5");
  }
}

function configWith(briefs: number, materializations: number): AppConfig {
  return {
    ...appConfig,
    ai: { ...appConfig.ai, boardRetries: { briefs, materializations } },
  };
}

const schema = makeBriefSchema(appConfig.boardSize);

describe("generateGame — the bounded retry policy of 03", () => {
  it("schema-valid briefs pass zod; the always-uncrossable brief never materializes", () => {
    expect(schema.safeParse(uncrossableBrief).success).toBe(true);
    expect(schema.safeParse(goodBrief).success).toBe(true);
    const board = materialize(uncrossableBrief, 1, engineCfg);
    const units = placeArmies(1, engineCfg);
    expect(
      checkInvariants(board, uncrossableBrief, units, engineCfg),
    ).not.toBeNull();
  });

  it("materializations: 1 stops after one attempt → regenerates → fallback", async () => {
    const llm = new QueuedLlm([uncrossableBrief]);
    const result = await generateGame({
      seed: 1, // attempt seeds 1 and 2 are both walled off (verified)
      llm,
      config: configWith(2, 1),
    });
    // one materialization attempt per brief, then the next brief of the budget
    expect(llm.calls).toBe(2);
    expect(result.usedFallback).toBe(true);
    expect(result.board).toEqual(
      materialize(FALLBACK_BRIEF, FALLBACK_SEED, engineCfg),
    );
  });

  it("the materializations budget comes from config: 1 regenerates early, 3 lets seed 11 win", async () => {
    const frugal = new QueuedLlm([seedSensitiveBrief, goodBrief]);
    const frugalResult = await generateGame({
      seed: 10, // attempt seed 10 fails, 11 would succeed (verified)
      llm: frugal,
      config: configWith(2, 1),
    });
    // one attempt on the bad brief → regenerate → the good brief wins
    expect(frugal.calls).toBe(2);
    expect(frugalResult.usedFallback).toBe(false);

    const patient = new QueuedLlm([seedSensitiveBrief, goodBrief]);
    const patientResult = await generateGame({
      seed: 10,
      llm: patient,
      config: configWith(2, 3),
    });
    // the second materialization attempt (seed 11) succeeds within budget
    expect(patient.calls).toBe(1);
    expect(patientResult.usedFallback).toBe(false);
  });

  it("the briefs budget comes from config — nothing is hardcoded", async () => {
    for (const briefs of [1, 2, 5]) {
      const llm = new QueuedLlm([{ nope: true }]); // always schema-invalid
      const result = await generateGame({
        seed: 1,
        llm,
        config: configWith(briefs, 3),
      });
      expect(llm.calls).toBe(briefs);
      expect(result.usedFallback).toBe(true);
    }
  });

  it("a degraded/offline LLM burns the briefs budget and falls back — never crashes", async () => {
    const llm = new QueuedLlm([THROW]);
    const result = await generateGame({
      seed: 1,
      llm,
      config: configWith(3, 3),
    });
    expect(llm.calls).toBe(3);
    expect(result.usedFallback).toBe(true);
  });

  it("only a failing FALLBACK board raises BoardGenerationError (03: a code bug)", async () => {
    const llm = new QueuedLlm([uncrossableBrief]);
    // the shipped fallback validates, so generation never throws at baseline
    const result = await generateGame({
      seed: 1,
      llm,
      config: configWith(1, 1),
    });
    expect(result.usedFallback).toBe(true);
    expect(BoardGenerationError).toBeDefined();
  });
});
