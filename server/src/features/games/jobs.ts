import type { Pool } from "pg";
import type { AppConfig } from "../../config/index.js";
import type { LlmClient } from "../ai/llmClient.js";
import { runAiTurn } from "../ai/aiTurn.js";
import { generateBoard } from "../board/generate.js";
import {
  completeBoardGeneration,
  failBoardGeneration,
  findGameById,
  listStaleAiTurnGames,
  listStaleGeneratingGames,
} from "./repo.js";

// in-process ACTIVE-JOB set: added synchronously before any await, removed on completion.
// Shared across board-generation and AI-turn jobs (per gameId).
const activeJobs = new Map<string, number>();

export function isJobActive(gameId: string): boolean {
  return activeJobs.has(gameId);
}

export function runBoardGenerationJob(
  pool: Pool,
  config: AppConfig,
  llm: LlmClient,
  gameId: string,
): void {
  if (activeJobs.has(gameId)) return;
  activeJobs.set(gameId, Date.now());

  void (async () => {
    try {
      const row = await findGameById(pool, gameId);
      if (!row || row.status !== "generating_board") {
        return;
      }
      const result = await generateBoard(gameId, config, llm);
      await completeBoardGeneration(pool, gameId, result.board, result.units, result.usedFallback);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Board generation failed";
      try {
        await failBoardGeneration(pool, gameId, message);
      } catch {
        // best-effort failure recording; sweep will retry later
      }
    } finally {
      activeJobs.delete(gameId);
    }
  })().catch(() => {
    // defensive: should not happen
  });
}

export function runAiTurnJob(pool: Pool, config: AppConfig, gameId: string): void {
  if (activeJobs.has(gameId)) return;
  activeJobs.set(gameId, Date.now());

  void (async () => {
    try {
      await runAiTurn(pool, config, gameId);
    } catch {
      // runAiTurn handles persistence on failure; swallow to avoid unhandled rejections
    } finally {
      activeJobs.delete(gameId);
    }
  })().catch(() => {
    // defensive
  });
}

export async function triggerStaleJobsForUser(
  pool: Pool,
  config: AppConfig,
  llm: LlmClient,
  userId: string,
): Promise<void> {
  const [staleBoard, staleAi] = await Promise.all([
    listStaleGeneratingGames(pool, config.ai.staleAfterSeconds, userId),
    listStaleAiTurnGames(pool, config.ai.staleAfterSeconds, userId),
  ]);
  for (const game of staleBoard) {
    runBoardGenerationJob(pool, config, llm, game.id);
  }
  for (const game of staleAi) {
    runAiTurnJob(pool, config, game.id);
  }
}

export async function sweepStaleJobs(pool: Pool, config: AppConfig, llm: LlmClient): Promise<void> {
  const [staleBoard, staleAi] = await Promise.all([
    listStaleGeneratingGames(pool, config.ai.staleAfterSeconds),
    listStaleAiTurnGames(pool, config.ai.staleAfterSeconds),
  ]);
  for (const game of staleBoard) {
    runBoardGenerationJob(pool, config, llm, game.id);
  }
  for (const game of staleAi) {
    runAiTurnJob(pool, config, game.id);
  }
}

export function startJobsSweep(pool: Pool, config: AppConfig, llm: LlmClient): NodeJS.Timeout {
  const intervalMs = Math.max(1, config.ai.sweepIntervalSeconds) * 1000;
  return setInterval(() => {
    void sweepStaleJobs(pool, config, llm).catch(() => {
      // sweep is best-effort; errors must not crash the process
    });
  }, intervalMs);
}

// Backward-compatible names used by earlier phases
export const triggerStaleBoardJobsForUser = triggerStaleJobsForUser;
export const sweepStaleBoardJobs = sweepStaleJobs;
export const startBoardSweep = startJobsSweep;
