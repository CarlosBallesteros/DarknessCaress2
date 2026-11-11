// Finished-game counts per (status, difficulty) — the stats tab's only source
// (docs/00: computed from finished game rows, there is no history table).
import { pool } from "../../db/pool";

export interface FinishedCount {
  status: string;
  difficulty: string;
  count: number;
}

// Games in flight (player_turn/ai_turn) are excluded; only won/lost count
// (docs/06 endpoint 8).
export async function finishedCountsByUser(
  userId: string,
): Promise<FinishedCount[]> {
  const { rows } = await pool.query<FinishedCount>(
    `SELECT status, difficulty, COUNT(*)::int AS count
     FROM games
     WHERE user_id = $1 AND status IN ('won', 'lost')
     GROUP BY status, difficulty`,
    [userId],
  );
  return rows;
}
