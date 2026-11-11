// The one module that owns the games table (docs/01: plain SQL, one small
// module per feature) plus the row→DTO mapper (docs/01 Runtime model:
// snake_case columns → camelCase DTOs). Phase 4 adds creation (endpoint 10's
// generating_board insert) and the board-design job's persistence; phase 5
// extends this with the turn-flow queries.
import { pool } from "../../db/pool";
import { config } from "../../config/load";
import type { Board, Tile, Unit } from "../../game/types";
import type { GameStateDto } from "./dto";

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

// The concurrency cap (docs/06 endpoint 10): counting EVERY game that is not
// lost — a generating_board game counts as active, and so does a finished
// `won` one. The contract's letter, not an interpretation.
export async function countActiveGames(userId: string): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM games WHERE user_id = $1 AND status <> 'lost'",
    [userId],
  );
  return rows[0].n;
}

// The all-plain placeholder grid of a fresh row (docs/06 endpoint 10): the
// real battlefield arrives when the background job finishes designing it.
export function placeholderBoard(): Board {
  const size = config.boardSize;
  return {
    tiles: Array.from({ length: size }, () => Array<Tile>(size).fill("plain")),
  };
}

export async function insertGeneratingGame(input: {
  id: string;
  userId: string;
  difficulty: string;
}): Promise<GameRow> {
  const { rows } = await pool.query<GameRow>(
    `INSERT INTO games (id, user_id, difficulty, status, board, units)
     VALUES ($1, $2, $3, 'generating_board', $4, '[]'::jsonb)
     RETURNING ${SELECT_COLUMNS}`,
    [input.id, input.userId, input.difficulty, JSON.stringify(placeholderBoard())],
  );
  return rows[0];
}

/** The job loads by id alone — it is internal, not user-scoped (docs/01). */
export async function getGameById(id: string): Promise<GameRow | undefined> {
  const { rows } = await pool.query<GameRow>(`SELECT ${SELECT_COLUMNS} FROM games WHERE id = $1`, [
    id,
  ]);
  return rows[0];
}

/** Every game reference is owned by the caller; unknown-or-foreign reads 404 (docs/06). */
export async function getGameByUser(userId: string, id: string): Promise<GameRow | undefined> {
  const { rows } = await pool.query<GameRow>(
    `SELECT ${SELECT_COLUMNS} FROM games WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  return rows[0];
}

/**
 * The board-design job's SUCCESS persist (docs/06 endpoint 10 + docs/01's
 * conditional-persist guard): `WHERE status = 'generating_board'` discards the
 * result if the game left the holding state meanwhile (a forfeit's `lost`
 * stands). Clears ai_last_error, records used_fallback.
 */
export async function completeBoardGeneration(
  id: string,
  input: { board: Board; units: Unit[]; usedFallback: boolean },
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE games
     SET status = 'player_turn', board = $2, units = $3, used_fallback = $4,
         ai_last_error = NULL, updated_at = now()
     WHERE id = $1 AND status = 'generating_board'`,
    [id, JSON.stringify(input.board), JSON.stringify(input.units), input.usedFallback],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * The board-design job's FAILURE persist (docs/06 endpoint 10): ai_last_error
 * set, status STAYS generating_board, updated_at = now() gives the row a
 * fresh sweep timer — the stale sweep re-triggers it forever, no client error
 * state ever.
 */
export async function markBoardGenerationFailed(id: string, error: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE games SET ai_last_error = $2, updated_at = now()
     WHERE id = $1 AND status = 'generating_board'`,
    [id, error],
  );
  return (result.rowCount ?? 0) > 0;
}

export function toGameStateDto(row: GameRow): GameStateDto {
  return {
    id: row.id,
    difficulty: row.difficulty,
    status: row.status as GameStateDto["status"],
    turnNumber: row.turn_number,
    board: row.board,
    units: row.units,
    lastAiActions: (row.last_ai_actions as GameStateDto["lastAiActions"]) ?? null,
    updatedAt: row.updated_at.toISOString(),
  };
}
