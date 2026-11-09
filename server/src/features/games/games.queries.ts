import { getPool } from "../../db/pool.js";
import type { GameRow } from "./game.dto.js";

const GAME_COLUMNS =
  "id, user_id, difficulty, status, board, units, turn_number, ai_last_error, used_fallback, last_ai_actions, created_at, updated_at";

/** Only games in flight count against the concurrency cap (06: endpoint 10). */
export async function countActiveGames(userId: string): Promise<number> {
  const result = await getPool().query<{ count: number }>(
    "SELECT COUNT(*)::int AS count FROM games WHERE user_id = $1 AND status IN ('player_turn', 'ai_turn')",
    [userId],
  );
  return result.rows[0].count;
}

export async function insertGame(input: {
  id: string;
  userId: string;
  difficulty: string;
  board: unknown;
  units: unknown;
  usedFallback: boolean;
}): Promise<GameRow> {
  const result = await getPool().query<GameRow>(
    `INSERT INTO games (id, user_id, difficulty, status, board, units, used_fallback)
     VALUES ($1, $2, $3, 'player_turn', $4, $5, $6)
     RETURNING ${GAME_COLUMNS}`,
    [
      input.id,
      input.userId,
      input.difficulty,
      JSON.stringify(input.board),
      JSON.stringify(input.units),
      input.usedFallback,
    ],
  );
  return result.rows[0];
}
