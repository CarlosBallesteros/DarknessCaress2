import { createHash } from "node:crypto";
import { toEngineConfig } from "../../config/config.js";
import type { AppConfig } from "../../config/config.js";
import type { Board, Unit } from "../../game/types.js";
import type { LlmClient } from "../ai/llmClient.js";
import { makeBriefSchema } from "./briefSchema.js";
import { buildBriefPrompt } from "./briefPrompt.js";
import { FALLBACK_BRIEF, FALLBACK_SEED } from "./fallback.js";
import { checkInvariants } from "./invariants.js";
import { materialize } from "./materialize.js";
import { placeArmies } from "./spawn.js";

/** Raised only when even the fallback board fails to validate (03: a code bug). */
export class BoardGenerationError extends Error {}

export interface GeneratedGame {
  board: Board;
  units: Unit[];
  usedFallback: boolean;
}

/** The game's uuid, hashed once, becomes the deterministic board seed (03). */
export function seedFromGameId(gameId: string): number {
  return createHash("sha256").update(gameId).digest().readUInt32BE(0);
}

/**
 * The bounded retry policy of 03, exact: materialize with (seed + attempt
 * counter) and validate invariants each time — first valid board wins;
 * ≤ config.ai.boardRetries.materializations per brief, ≤ briefs total. A brief
 * that cannot produce a valid board (schema-invalid response, unparsable or
 * unreachable LLM) is regenerated at the unchanged temperature (the client
 * owns the temperature). When every brief of the budget failed, the
 * FALLBACK_BRIEF is materialized with FALLBACK_SEED through the same pipeline;
 * only if even the fallback fails does generation throw (route ⇒ 503).
 */
export async function generateGame(opts: {
  seed: number;
  llm: LlmClient;
  config: AppConfig;
}): Promise<GeneratedGame> {
  const { config, llm, seed } = opts;
  const engineCfg = toEngineConfig(config);
  const schema = makeBriefSchema(config.boardSize);
  const prompt = buildBriefPrompt(config.boardSize);
  let attempt = 0;
  for (
    let briefsLeft = config.ai.boardRetries.briefs;
    briefsLeft > 0;
    briefsLeft--
  ) {
    let raw: unknown;
    try {
      raw = await llm.brief({ user: prompt });
    } catch {
      // Degraded/offline LLM counts as a lost brief, never a crash (03/04).
      continue;
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      continue; // bad brief → regenerate (03 step 2)
    }
    const brief = parsed.data;
    for (
      let materializations = 0;
      materializations < config.ai.boardRetries.materializations;
      materializations++
    ) {
      const board = materialize(brief, seed + attempt, engineCfg);
      attempt += 1;
      const units = placeArmies(seed, engineCfg);
      if (checkInvariants(board, brief, units, engineCfg) === null) {
        return { board, units, usedFallback: false };
      }
    }
  }
  const board = materialize(FALLBACK_BRIEF, FALLBACK_SEED, engineCfg);
  const units = placeArmies(seed, engineCfg);
  if (checkInvariants(board, FALLBACK_BRIEF, units, engineCfg) !== null) {
    throw new BoardGenerationError("even the fallback board failed validation");
  }
  return { board, units, usedFallback: true };
}
