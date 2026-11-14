import type { Board, Unit } from "../../game/types";
import type { GameEngineConfig } from "../../game/types";
import type { AppConfig } from "../../config";
import type { LlmClient } from "../ai/llmClient";
import { boardBriefSchema, type BoardBrief } from "./briefSchema";
import { materializeBoard } from "./materialize";
import { validateBoard } from "./invariants";
import { spawnArmies } from "./spawn";
import { FALLBACK_BRIEF, FALLBACK_SEED } from "./fallback";
import { buildBriefPrompt } from "./briefPrompt";
import { boardBriefJsonSchema } from "./briefJsonSchema";

export interface GeneratedBoardResult {
  board: Board;
  units: Unit[];
  usedFallback: boolean;
}

export interface BoardRetriesConfig {
  materializations: number;
  briefs: number;
}

export function parseBrief(raw: unknown): BoardBrief {
  return boardBriefSchema.parse(raw);
}

export async function requestBrief(
  llm: LlmClient,
  config: Pick<AppConfig, "boardSize" | "ai">,
  user = "system",
): Promise<BoardBrief> {
  // Prefer client.brief() which follows spec contract; fallback to chat if needed
  const anyClient = llm as LlmClient & { brief?: (opts: { user: string }) => Promise<unknown> };
  let raw: unknown;
  if (typeof anyClient.brief === "function") {
    raw = await anyClient.brief({ user });
  } else {
    const prompt = buildBriefPrompt({ boardSize: config.boardSize });
    raw = await llm.chat({
      messages: [{ role: "user", content: prompt }],
      temperature: config.ai.briefTemperature,
      schema: boardBriefJsonSchema,
    });
  }
  return parseBrief(raw);
}

export function tryMaterializeValid(
  brief: BoardBrief,
  seed: string,
  materializations: number,
  boardSize: number,
): Board | null {
  for (let attempt = 0; attempt < materializations; attempt++) {
    const { board } = materializeBoard(brief, seed, attempt);
    const err = validateBoard(board, brief, boardSize);
    if (err === null) {
      return board;
    }
  }
  return null;
}

export async function generateBoardWithRetries(
  gameId: string,
  llm: LlmClient,
  appConfig: Pick<AppConfig, "boardSize" | "ai">,
  engineConfig: GameEngineConfig,
): Promise<GeneratedBoardResult> {
  const retries: BoardRetriesConfig = appConfig.ai.boardRetries;
  const seed = gameId; // hashed inside materializer/RNG derivation

  for (let briefAttempt = 0; briefAttempt < retries.briefs; briefAttempt++) {
    let brief: BoardBrief;
    try {
      brief = await requestBrief(llm, appConfig);
    } catch {
      // failed brief generation counts as a bad brief attempt? regenerate by looping
      continue;
    }

    const board = tryMaterializeValid(brief, seed, retries.materializations, appConfig.boardSize);
    if (board) {
      const units = spawnArmies(seed, engineConfig);
      return { board, units, usedFallback: false };
    }
  }

  // Fallback: same pipeline, fixed seed
  const fallbackBoard = tryMaterializeValid(FALLBACK_BRIEF, FALLBACK_SEED, 1, appConfig.boardSize);
  if (!fallbackBoard) {
    // try a few attempts with fallback seed anyway to be robust
    const retryFallback = tryMaterializeValid(
      FALLBACK_BRIEF,
      FALLBACK_SEED,
      Math.max(1, retries.materializations),
      appConfig.boardSize,
    );
    if (!retryFallback) {
      throw new Error("Fallback board failed to validate");
    }
    const units = spawnArmies(FALLBACK_SEED, engineConfig);
    return { board: retryFallback, units, usedFallback: true };
  }
  const units = spawnArmies(FALLBACK_SEED, engineConfig);
  return { board: fallbackBoard, units, usedFallback: true };
}
