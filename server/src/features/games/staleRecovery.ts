import { config } from "../../config";
import { pool } from "../../db/pool";
import { hasActiveJob } from "./activeJobs";
import { kickOffBoardGeneration } from "./boardJob";

export async function maybeRecoverStaleJobForGame(gameId: string): Promise<void> {
  if (hasActiveJob(gameId)) return;

  const staleSeconds = config.ai.staleAfterSeconds;
  const result = await pool.query<{ status: string }>(
    `SELECT status
     FROM games
     WHERE id = $1
       AND (
         (status = 'generating_board' AND now() - updated_at > ($2::int * interval '1 second'))
         OR
         (status = 'ai_turn' AND now() - updated_at > ($2::int * interval '1 second'))
       )`,
    [gameId, staleSeconds],
  );
  const status = result.rows[0]?.status;
  if (status === "generating_board") {
    kickOffBoardGeneration(gameId);
  }
  // ai_turn recovery will be handled in phase 5
}
