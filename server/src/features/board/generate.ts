// Board generation orchestration (docs/03): the bounded retry policy over
// LLM briefs and seeded materializations. Budget from config
// (config.ai.boardRetries): ≤ materializations per brief, ≤ briefs total —
// never hardcoded. All briefs exhausted ⇒ the committed fallback brief with
// the fixed fallback seed, through the SAME pipeline; failure even there is a
// code bug and surfaces as BoardGenerationError (the route maps it to 503).
import { config } from "../../config/config";
import type { Board } from "../../game/types";
import { briefSchema, type Brief } from "./brief-schema";
import { FALLBACK_BRIEF, FALLBACK_SEED } from "./fallback";
import { materialize } from "./materialize";
import { validateBoard } from "./invariants";

export class BoardGenerationError extends Error {
  constructor(message = "every board attempt failed, including the fallback") {
    super(message);
  }
}

export interface BoardGenerationResult {
  board: Board;
  brief: Brief;
  usedFallback: boolean;
}

export interface BoardRetries {
  materializations: number;
  briefs: number;
}

// `briefSource` and `retries` are injectable seams for tests; the route uses
// the defaults (LLM client + config budget).
export async function generateBoard(
  seed: number,
  deps: {
    briefSource: () => Promise<unknown>;
    retries?: BoardRetries;
  },
): Promise<BoardGenerationResult> {
  const retries = deps.retries ?? config.ai.boardRetries;

  for (let briefIndex = 0; briefIndex < retries.briefs; briefIndex++) {
    // A thrown LLM error (degraded/offline) is a failed brief, never a crash:
    // it consumes one brief of the budget and the loop continues.
    const rawBrief = await deps.briefSource().catch(() => null);
    const parsed = briefSchema.safeParse(rawBrief);
    if (!parsed.success) continue; // bad brief → the next brief of the budget
    for (let attempt = 1; attempt <= retries.materializations; attempt++) {
      const board = materialize(parsed.data, seed + attempt);
      const failure = validateBoard(board, parsed.data);
      if (failure === null) {
        return { board, brief: parsed.data, usedFallback: false };
      }
    }
    // All materializations of one brief failed → regenerate the brief.
  }

  // LLM degraded/offline (or briefs kept failing): the committed fallback
  // brief, same pipeline, same fixed seed — fully deterministic.
  const board = materialize(FALLBACK_BRIEF, FALLBACK_SEED);
  const failure = validateBoard(board, FALLBACK_BRIEF);
  if (failure !== null) {
    throw new BoardGenerationError(`fallback board is invalid: ${failure}`);
  }
  return { board, brief: FALLBACK_BRIEF, usedFallback: true };
}
