import { pool } from "../../db/pool";
import type { GameRow } from "./dto";
import type { Board } from "../../game/types";

export async function insertGeneratingGame(args: {
  userId: string;
  difficulty: string;
  board: Board;
}): Promise<GameRow> {
  const result = await pool.query<GameRow>(
    `INSERT INTO games (user_id, difficulty, status, board, units, turn_number, last_ai_actions)
     VALUES ($1, $2, 'generating_board', $3::jsonb, '[]'::jsonb, 1, NULL)
     RETURNING id, user_id, difficulty, status, board, units, turn_number, ai_last_error,
               used_fallback, moves_applied, last_ai_actions, created_at, updated_at`,
    [args.userId, args.difficulty, JSON.stringify(args.board)],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Failed to insert game");
  return row;
}

export async function countActiveGames(userId: string): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM games
     WHERE user_id = $1 AND status IN ('generating_board', 'player_turn', 'ai_turn')`,
    [userId],
  );
  return Number(result.rows[0]?.count ?? "0");
}

export async function findGameById(id: string): Promise<GameRow | null> {
  const result = await pool.query<GameRow>(
    `SELECT id, user_id, difficulty, status, board, units, turn_number, ai_last_error,
            used_fallback, moves_applied, last_ai_actions, created_at, updated_at
     FROM games WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function markBoardReady(args: {
  gameId: string;
  board: Board;
  units: unknown[];
  usedFallback: boolean;
}): Promise<number> {
  const result = await pool.query(
    `UPDATE games
     SET status = 'player_turn',
         board = $2::jsonb,
         units = $3::jsonb,
         used_fallback = $4,
         ai_last_error = NULL,
         updated_at = now()
     WHERE id = $1 AND status = 'generating_board'`,
    [args.gameId, JSON.stringify(args.board), JSON.stringify(args.units), args.usedFallback],
  );
  return result.rowCount ?? 0;
}

export async function markBoardGenerationFailed(
  gameId: string,
  errorMessage: string,
): Promise<void> {
  await pool.query(
    `UPDATE games
     SET ai_last_error = $2,
         updated_at = now()
     WHERE id = $1 AND status = 'generating_board'`,
    [gameId, errorMessage],
  );
}
