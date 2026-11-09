import { getPool } from "../../db/pool.js";

/** Finished-game counts per (status, difficulty) — the stats tab's only source (00). */
export interface FinishedCount {
  status: string;
  difficulty: string;
  count: number;
}

/**
 * Statistics come from FINISHED game rows only — there is no history table;
 * games in flight are excluded (06 ep. 8).
 */
export async function finishedCountsByUser(
  userId: string,
): Promise<FinishedCount[]> {
  const result = await getPool().query<FinishedCount>(
    `SELECT status, difficulty, COUNT(*)::int AS count
     FROM games
     WHERE user_id = $1 AND status IN ('won', 'lost')
     GROUP BY status, difficulty`,
    [userId],
  );
  return result.rows;
}
