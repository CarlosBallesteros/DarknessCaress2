// Board generation orchestration (docs/03): the bounded retry policy over
// LLM briefs and seeded materializations. Budget from config
// (config.ai.boardRetries): ≤ materializations per brief, ≤ briefs total —
// never hardcoded. All briefs exhausted ⇒ the committed fallback brief with
// the fixed fallback seed, through the SAME pipeline; failure even there is a
// code bug and surfaces as BoardGenerationError (the background job records
// it in ai_last_error — docs/06 endpoint 10's async flow has no client error
// state; the stale sweep keeps retrying).
import { config } from "../../config/load";
import { engineConfig } from "../../config/engine";
import type { Board, Unit } from "../../game/types";
import { briefSchema, type Brief } from "./briefSchema";
import { FALLBACK_BRIEF, FALLBACK_SEED } from "./fallback";
import { materialize } from "./materialize";
import { validateBoard, validateSpawn } from "./invariants";
import { assembleArmies } from "./spawn";

export class BoardGenerationError extends Error {
  constructor(message = "every board attempt failed, including the fallback") {
    super(message);
    this.name = "BoardGenerationError";
  }
}

export interface BoardGenerationResult {
  board: Board;
  units: Unit[];
  brief: Brief;
  usedFallback: boolean;
}

export interface BoardRetries {
  materializations: number;
  briefs: number;
}

// `briefSource` and `retries` are injectable seams for tests; the job uses
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
      // A materializer throw (e.g. a river with no crossable stretch) is a
      // failed attempt of the budget too — never an escaped crash.
      let board: Board;
      try {
        board = materialize(parsed.data, seed + attempt);
      } catch {
        continue;
      }
      if (validateBoard(board, parsed.data) === null) {
        return finish(parsed.data, board, seed, false);
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
  return finish(FALLBACK_BRIEF, board, seed, true);
}

// The armies don't depend on the brief: they scatter from the game's own
// seed, so they are assembled and validated once per pipeline run (docs/03
// invariant 5).
function finish(
  brief: Brief,
  board: Board,
  seed: number,
  usedFallback: boolean,
): BoardGenerationResult {
  const units = assembleArmies(seed, engineConfig);
  const spawnFailure = validateSpawn(board, units, engineConfig);
  if (spawnFailure !== null) {
    throw new BoardGenerationError(`spawn layout is invalid: ${spawnFailure}`);
  }
  return { board, units, brief, usedFallback };
}
