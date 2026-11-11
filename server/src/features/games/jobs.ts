// Background job machinery shared by every game job kind (docs/01 Runtime
// model: "Background jobs (two kinds, one mechanism)"). Phase 4 ships the
// board-design job; phase 5's AI-turn job plugs into the same ACTIVE-JOB set
// guard and stale sweep.
import { pool } from "../../db/pool";
import { config } from "../../config/load";
import { getLlmClient } from "../ai/llmClient";
import { briefPrompt } from "../board/briefPrompt";
import { generateBoard } from "../board/generate";
import { hashUuidToSeed } from "../board/prng";
import { completeBoardGeneration, getGameById, markBoardGenerationFailed } from "./repo";

// docs/01's ACTIVE-JOB set — the race-proof idempotency guard. An entry is
// added SYNCHRONOUSLY (check-and-set in the same tick, before any await) and
// removed only when the job completes (success or failure); a sweep skips any
// game with an active entry. No time window: however long the job takes, a
// running job is never double-launched. A server restart empties the map —
// precisely when self-heal is wanted.
const activeJobs = new Map<string, number>();

export function isJobRunning(gameId: string): boolean {
  return activeJobs.has(gameId);
}

// Fire-and-forget launcher (docs/01): callers kick the job off without
// awaiting it, with an appended safe catch that logs. Also the single entry
// point for the stale-recovery sweep — the guard makes re-triggering
// idempotent. Synchronous check-and-set BEFORE any await.
export function startGameJob(gameId: string, job: (gameId: string) => Promise<void>): void {
  if (activeJobs.has(gameId)) return;
  activeJobs.set(gameId, Date.now());
  job(gameId)
    .catch((err: unknown) => {
      console.error(`background job failed for game ${gameId}:`, err);
    })
    .finally(() => {
      activeJobs.delete(gameId);
    });
}

// The board-design job (docs/06 endpoint 10): the inserted row carries an
// all-plain placeholder board and empty armies; this job designs the real
// battlefield (LLM brief + materialization + retry policy, docs/03) from the
// game's uuid — hashed once into the generation seed — and flips the row to
// player_turn under the conditional-persist guard. On failure it writes
// ai_last_error, refreshes updated_at, and LEAVES generating_board: the stale
// sweep retries forever, no client error state ever.
export async function runBoardDesignJob(gameId: string): Promise<void> {
  const row = await getGameById(gameId);
  if (row === undefined || row.status !== "generating_board") {
    return;
  }
  const seed = hashUuidToSeed(gameId);
  try {
    const generated = await generateBoard(seed, {
      briefSource: () => getLlmClient().brief({ user: briefPrompt() }),
    });
    await completeBoardGeneration(gameId, {
      board: generated.board,
      units: generated.units,
      usedFallback: generated.usedFallback,
    });
  } catch (err) {
    await markBoardGenerationFailed(gameId, err instanceof Error ? err.message : String(err));
  }
}

// Stale recovery (docs/01, endpoints 9/11 side effect): re-triggers jobs for
// the user's games sitting in a job-owned status with an updated_at older
// than config.ai.staleAfterSeconds. Optionally scoped to one game. Phase 4
// sweeps generating_board rows; phase 5 adds the ai_turn arm — the guard
// already makes both idempotent.
export async function retriggerStaleJobs(userId: string, gameId?: string): Promise<void> {
  const params: unknown[] = [userId, config.ai.staleAfterSeconds];
  let sql = `SELECT id FROM games
             WHERE user_id = $1 AND status = 'generating_board'
               AND updated_at < now() - make_interval(secs => $2::int)`;
  if (gameId !== undefined) {
    sql += " AND id = $3";
    params.push(gameId);
  }
  const { rows } = await pool.query<{ id: string }>(sql, params);
  for (const row of rows) {
    startGameJob(row.id, runBoardDesignJob);
  }
}
