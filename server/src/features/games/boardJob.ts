import { config } from "../../config";
import { gameEngineConfig } from "../../game/config";
import { createLlmClient } from "../ai";
import { generateBoardWithRetries } from "../board/generate";
import { finishActiveJob, tryStartActiveJob } from "./activeJobs";
import { findGameById, markBoardGenerationFailed, markBoardReady } from "./repo";

export async function runBoardGenerationJob(gameId: string): Promise<void> {
  if (!tryStartActiveJob(gameId)) {
    return;
  }

  try {
    const row = await findGameById(gameId);
    if (!row || row.status !== "generating_board") {
      return;
    }

    const llm = createLlmClient();
    const result = await generateBoardWithRetries(gameId, llm, config, gameEngineConfig);

    await markBoardReady({
      gameId,
      board: result.board,
      units: result.units,
      usedFallback: result.usedFallback,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Board generation failed";
    try {
      await markBoardGenerationFailed(gameId, message);
    } catch {
      // best effort: sweep will retry based on stale timer
    }
  } finally {
    finishActiveJob(gameId);
  }
}

export function kickOffBoardGeneration(gameId: string): void {
  void runBoardGenerationJob(gameId).catch((err) => {
    console.error("unhandled board generation job error", err);
  });
}
