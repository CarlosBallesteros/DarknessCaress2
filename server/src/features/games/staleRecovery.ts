import { config } from "../../config";
import { pool } from "../../db/pool";
import { hasActiveJob } from "./activeJobs";
import { kickOffBoardGeneration } from "./boardJob";
import { kickOffAiTurn } from "../ai/aiTurn";

async function recoverIfStale(gameId: string): Promise<void> {
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
  } else if (status === "ai_turn") {
    kickOffAiTurn(gameId);
  }
}

export async function maybeRecoverStaleJobForGame(gameId: string): Promise<void> {
  await recoverIfStale(gameId);
}

export async function recoverStaleJobsForUser(userId: string): Promise<void> {
  const staleSeconds = config.ai.staleAfterSeconds;
  const result = await pool.query<{ id: string; status: string }>(
    `SELECT id, status
     FROM games
     WHERE user_id = $1
       AND (
         (status = 'generating_board' AND now() - updated_at > ($2::int * interval '1 second'))
         OR
         (status = 'ai_turn' AND now() - updated_at > ($2::int * interval '1 second'))
       )`,
    [userId, staleSeconds],
  );
  for (const row of result.rows) {
    if (hasActiveJob(row.id)) continue;
    if (row.status === "generating_board") {
      kickOffBoardGeneration(row.id);
    } else if (row.status === "ai_turn") {
      kickOffAiTurn(row.id);
    }
  }
}

export async function sweepAllStaleJobs(): Promise<void> {
  const staleSeconds = config.ai.staleAfterSeconds;
  const result = await pool.query<{ id: string; status: string }>(
    `SELECT id, status
     FROM games
     WHERE (status = 'generating_board' AND now() - updated_at > ($1::int * interval '1 second'))
        OR (status = 'ai_turn' AND now() - updated_at > ($1::int * interval '1 second'))`,
    [staleSeconds],
  );
  for (const row of result.rows) {
    if (hasActiveJob(row.id)) continue;
    if (row.status === "generating_board") {
      kickOffBoardGeneration(row.id);
    } else if (row.status === "ai_turn") {
      kickOffAiTurn(row.id);
    }
  }
}
