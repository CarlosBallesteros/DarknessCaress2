import type { Pool } from "pg";
import type { AppConfig } from "../../config/index.js";
import type { LlmClient } from "../ai/llmClient.js";
import { generateBoard } from "../board/generate.js";
import {
  completeBoardGeneration,
  failBoardGeneration,
  findGameById,
  listStaleGeneratingGames,
} from "./repo.js";

// in-process ACTIVE-JOB set: added synchronously before any await, removed on completion.
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
  })();
}

export async function triggerStaleBoardJobsForUser(
  pool: Pool,
  config: AppConfig,
  llm: LlmClient,
  userId: string,
): Promise<void> {
  const stale = await listStaleGeneratingGames(pool, config.ai.staleAfterSeconds, userId);
  for (const game of stale) {
    runBoardGenerationJob(pool, config, llm, game.id);
  }
}

export async function sweepStaleBoardJobs(
  pool: Pool,
  config: AppConfig,
  llm: LlmClient,
): Promise<void> {
  const stale = await listStaleGeneratingGames(pool, config.ai.staleAfterSeconds);
  for (const game of stale) {
    runBoardGenerationJob(pool, config, llm, game.id);
  }
}

export function startBoardSweep(pool: Pool, config: AppConfig, llm: LlmClient): NodeJS.Timeout {
  const intervalMs = Math.max(1, config.ai.sweepIntervalSeconds) * 1000;
  return setInterval(() => {
    void sweepStaleBoardJobs(pool, config, llm).catch(() => {
      // sweep is best-effort; errors must not crash the process
    });
  }, intervalMs);
}
