import type { AppConfig } from "../../config/index.js";
import type { LlmClient } from "../ai/llmClient.js";
import { LlmError } from "../ai/llmClient.js";
import { buildBriefPrompt, briefJsonSchema } from "./briefPrompt.js";
import { parseBrief, type BoardBrief } from "./briefSchema.js";
import { FALLBACK_BRIEF, FALLBACK_SEED } from "./fallback.js";
import { validateBoard } from "./invariants.js";
import { materialize, type MaterializedBoard } from "./materialize.js";

export interface GenerateBoardResult {
  board: MaterializedBoard["board"];
  units: MaterializedBoard["units"];
  usedFallback: boolean;
}

function hashSeed(input: string): string {
  // Deterministic hash-once of game uuid for use as materialization seed base.
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

export async function generateBoard(
  gameId: string,
  config: AppConfig,
  llm: LlmClient,
): Promise<GenerateBoardResult> {
  const retries = config.ai.boardRetries;
  const materializationsPerBrief = retries.materializations;
  const briefBudget = retries.briefs;
  const boardSize = config.boardSize;
  const baseSeed = hashSeed(gameId);

  for (let briefIndex = 0; briefIndex < briefBudget; briefIndex++) {
    let brief: BoardBrief | null = null;
    try {
      const raw = await llm.brief({
        user: "board-generator",
        prompt: buildBriefPrompt(boardSize),
        temperature: config.ai.briefTemperature,
        schema: briefJsonSchema(boardSize),
      });
      brief = parseBrief(raw, boardSize);
    } catch (err) {
      // bad/unavailable brief attempt -> try next brief (counts against brief budget)
      void err;
      brief = null;
    }

    if (!brief) continue;

    for (let m = 0; m < materializationsPerBrief; m++) {
      const attemptSeed = `${baseSeed}:${briefIndex}:${m}`;
      const materialized = materialize(brief, attemptSeed, config);
      const validation = validateBoard(materialized.board, brief, boardSize);
      if (validation.ok) {
        return { board: materialized.board, units: materialized.units, usedFallback: false };
      }
    }
    // all materializations of this brief failed -> regenerate brief (next loop)
  }

  // Fallback: committed constant brief through same pipeline with fixed seed
  const fallbackMaterialized = materialize(FALLBACK_BRIEF, FALLBACK_SEED, config);
  const fallbackValidation = validateBoard(fallbackMaterialized.board, FALLBACK_BRIEF, boardSize);
  if (!fallbackValidation.ok) {
    throw new LlmError("Fallback board failed validation");
  }
  return {
    board: fallbackMaterialized.board,
    units: fallbackMaterialized.units,
    usedFallback: true,
  };
}

// Exported for tests that need deterministic materialization with a given seed+brief.
export function materializeBriefForTest(
  brief: BoardBrief,
  seed: string,
  config: AppConfig,
): GenerateBoardResult {
  const m = materialize(brief, seed, config);
  return { board: m.board, units: m.units, usedFallback: false };
}

export { hashSeed };
