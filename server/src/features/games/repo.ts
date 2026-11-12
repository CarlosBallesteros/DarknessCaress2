import type { Pool } from "pg";
import type { Board, Unit } from "../../game/types.js";
import type { GameRow } from "./dto.js";

export async function countActiveGames(pool: Pool, userId: string): Promise<number> {
  // 06: counting every game that is not `lost`
  const res = await pool.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM games WHERE user_id = $1 AND status <> 'lost'",
    [userId],
  );
  return Number(res.rows[0]?.count ?? "0");
}

export async function insertGeneratingGame(
  pool: Pool,
  userId: string,
  difficulty: string,
  board: Board,
): Promise<GameRow> {
  const res = await pool.query<GameRow>(
    `INSERT INTO games (user_id, difficulty, status, board, units, turn_number, last_ai_actions)
     VALUES ($1, $2, 'generating_board', $3::jsonb, $4::jsonb, 1, NULL)
     RETURNING *`,
    [userId, difficulty, JSON.stringify(board), JSON.stringify([])],
  );
  return res.rows[0]!;
}

export async function findGameById(pool: Pool, id: string): Promise<GameRow | null> {
  const res = await pool.query<GameRow>("SELECT * FROM games WHERE id = $1", [id]);
  return res.rows[0] ?? null;
}

export async function findGameByIdForUser(
  pool: Pool,
  id: string,
  userId: string,
): Promise<GameRow | null> {
  const res = await pool.query<GameRow>("SELECT * FROM games WHERE id = $1 AND user_id = $2", [
    id,
    userId,
  ]);
  return res.rows[0] ?? null;
}

export async function completeBoardGeneration(
  pool: Pool,
  gameId: string,
  board: Board,
  units: Unit[],
  usedFallback: boolean,
): Promise<void> {
  await pool.query(
    `UPDATE games
     SET status = 'player_turn',
         board = $2::jsonb,
         units = $3::jsonb,
         used_fallback = $4,
         ai_last_error = NULL,
         updated_at = now()
     WHERE id = $1`,
    [gameId, JSON.stringify(board), JSON.stringify(units), usedFallback],
  );
}

export async function failBoardGeneration(
  pool: Pool,
  gameId: string,
  error: string,
): Promise<void> {
  await pool.query(
    `UPDATE games
     SET ai_last_error = $2,
         updated_at = now()
     WHERE id = $1 AND status = 'generating_board'`,
    [gameId, error],
  );
}

export async function listStaleGeneratingGames(
  pool: Pool,
  staleAfterSeconds: number,
  userId?: string,
): Promise<GameRow[]> {
  if (userId) {
    const res = await pool.query<GameRow>(
      `SELECT * FROM games
       WHERE user_id = $1
         AND status = 'generating_board'
         AND now() - updated_at > ($2::int * interval '1 second')`,
      [userId, staleAfterSeconds],
    );
    return res.rows;
  }
  const res = await pool.query<GameRow>(
    `SELECT * FROM games
     WHERE status = 'generating_board'
       AND now() - updated_at > ($1::int * interval '1 second')`,
    [staleAfterSeconds],
  );
  return res.rows;
}

export async function listStaleAiTurnGames(
  pool: Pool,
  staleAfterSeconds: number,
  userId?: string,
): Promise<GameRow[]> {
  if (userId) {
    const res = await pool.query<GameRow>(
      `SELECT * FROM games
       WHERE user_id = $1
         AND status = 'ai_turn'
         AND now() - updated_at > ($2::int * interval '1 second')`,
      [userId, staleAfterSeconds],
    );
    return res.rows;
  }
  const res = await pool.query<GameRow>(
    `SELECT * FROM games
     WHERE status = 'ai_turn'
       AND now() - updated_at > ($1::int * interval '1 second')`,
    [staleAfterSeconds],
  );
  return res.rows;
}
