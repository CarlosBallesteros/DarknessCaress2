// The one module that owns the games table (docs/01: plain SQL, one small
// module per feature) plus the row→DTO mapper (docs/01 Runtime model:
// snake_case columns → camelCase DTOs).
import { pool } from "../../db/pool";
import type { Board, Unit } from "../../game/types";
import type { GameStateDto } from "./games.dto";

export interface GameRow {
  id: string;
  user_id: string;
  difficulty: string;
  status: string;
  board: Board;
  units: Unit[];
  turn_number: number;
  ai_last_error: string | null;
  used_fallback: boolean;
  moves_applied: boolean;
  last_ai_actions: unknown;
  created_at: Date;
  updated_at: Date;
}

const SELECT_COLUMNS =
  "id, user_id, difficulty, status, board, units, turn_number, ai_last_error, used_fallback, moves_applied, last_ai_actions, created_at, updated_at";

// Active games for the concurrency cap (docs/06 endpoint 10): counting
// `player_turn` + `ai_turn` only.
export async function countActiveGames(userId: string): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM games
     WHERE user_id = $1 AND status IN ('player_turn', 'ai_turn')`,
    [userId],
  );
  return rows[0].n;
}

export async function insertGame(input: {
  id: string;
  userId: string;
  difficulty: string;
  board: Board;
  units: Unit[];
  usedFallback: boolean;
}): Promise<GameRow> {
  const { rows } = await pool.query<GameRow>(
    `INSERT INTO games (id, user_id, difficulty, status, board, units, used_fallback)
     VALUES ($1, $2, $3, 'player_turn', $4, $5, $6)
     RETURNING ${SELECT_COLUMNS}`,
    [
      input.id,
      input.userId,
      input.difficulty,
      JSON.stringify(input.board),
      JSON.stringify(input.units),
      input.usedFallback,
    ],
  );
  return rows[0];
}

export function toGameStateDto(row: GameRow): GameStateDto {
  return {
    id: row.id,
    difficulty: row.difficulty,
    status: row.status as GameStateDto["status"],
    turnNumber: row.turn_number,
    board: row.board,
    units: row.units,
    lastAiActions:
      (row.last_ai_actions as GameStateDto["lastAiActions"]) ?? null,
    updatedAt: row.updated_at.toISOString(),
  };
}
