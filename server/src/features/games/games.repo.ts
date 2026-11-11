// The one module that owns the games table (docs/01: plain SQL, one small
// module per feature) plus the row→DTO mapper (docs/01 Runtime model:
// snake_case columns → camelCase DTOs).
import { pool } from "../../db/pool";
import type { Board, Unit } from "../../game/types";
import type { GameStateDto, GameSummaryDto } from "./games.dto";

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

export function toGameSummaryDto(row: GameRow): GameSummaryDto {
  return {
    id: row.id,
    difficulty: row.difficulty,
    status: row.status as GameSummaryDto["status"],
    turnNumber: row.turn_number,
    updatedAt: row.updated_at.toISOString(),
    // the strip cards' mini-map projection — the row's board JSON, verbatim
    previewBoard: row.board,
  };
}

/** The AI job loads by id alone — it is internal, not user-scoped (docs/01). */
export async function getGameById(id: string): Promise<GameRow | undefined> {
  const { rows } = await pool.query<GameRow>(
    `SELECT ${SELECT_COLUMNS} FROM games WHERE id = $1`,
    [id],
  );
  return rows[0];
}

/** Every game reference is owned by the caller; unknown-or-foreign reads 404 (docs/06). */
export async function getGameByUser(
  userId: string,
  id: string,
): Promise<GameRow | undefined> {
  const { rows } = await pool.query<GameRow>(
    `SELECT ${SELECT_COLUMNS} FROM games WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  return rows[0];
}

/** Creation order is the player's mental map — never reshuffled (docs/06 ep. 9). */
export async function listGamesByUser(userId: string): Promise<GameRow[]> {
  const { rows } = await pool.query<GameRow>(
    `SELECT ${SELECT_COLUMNS} FROM games
     WHERE user_id = $1 ORDER BY created_at ASC, id ASC`,
    [userId],
  );
  return rows;
}

/**
 * Endpoint 13's atomic apply (docs/06): one conditional UPDATE persists the
 * applied bundle. `AND NOT moves_applied` makes the once-per-round lock
 * race-proof — a concurrent second submission finds zero rows and is answered
 * 409. An empty bundle takes the same path ("applies nothing, consumes the
 * budget"), which is exactly what keeps the lock restart-proof (the
 * schema-borne games.moves_applied, not in-process state).
 */
export async function applyPlayerMoves(
  id: string,
  units: Unit[],
  status: "player_turn" | "won",
): Promise<GameRow | undefined> {
  const { rows } = await pool.query<GameRow>(
    `UPDATE games
     SET units = $2, status = $3, moves_applied = true, updated_at = now()
     WHERE id = $1 AND status = 'player_turn' AND moves_applied = false
     RETURNING ${SELECT_COLUMNS}`,
    [id, JSON.stringify(units), status],
  );
  return rows[0];
}

/**
 * Endpoint 14's single stroke: status flips to ai_turn, BOTH armies' acted
 * flags reset, and the round's moves lock clears — turn_number unchanged
 * (docs/06 endpoint 14).
 */
export async function beginAiTurn(
  id: string,
  resetUnits: Unit[],
): Promise<GameRow | undefined> {
  const { rows } = await pool.query<GameRow>(
    `UPDATE games
     SET status = 'ai_turn', units = $2, moves_applied = false, updated_at = now()
     WHERE id = $1 AND status = 'player_turn'
     RETURNING ${SELECT_COLUMNS}`,
    [id, JSON.stringify(resetUnits)],
  );
  return rows[0];
}

/** The victory short-circuit at end-turn: all enemies dead ⇒ won, no AI turn. */
export async function endTurnWon(id: string): Promise<GameRow | undefined> {
  const { rows } = await pool.query<GameRow>(
    `UPDATE games SET status = 'won', updated_at = now()
     WHERE id = $1 AND status = 'player_turn'
     RETURNING ${SELECT_COLUMNS}`,
    [id],
  );
  return rows[0];
}

/**
 * A successful AI turn persists CONDITIONALLY (docs/01): `WHERE status =
 * 'ai_turn'` discards the result when the game left ai_turn meanwhile (a
 * forfeit during thinking). turn_number advances ONLY here — the 1-based
 * current round (docs/06 endpoint 14).
 */
export async function applyAiTurnResult(
  id: string,
  input: {
    status: "player_turn" | "lost";
    units: Unit[];
    lastAiActions: unknown;
  },
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE games
     SET status = $2, units = $3, turn_number = turn_number + 1,
         last_ai_actions = $4, ai_last_error = NULL, updated_at = now()
     WHERE id = $1 AND status = 'ai_turn'`,
    [
      id,
      input.status,
      JSON.stringify(input.units),
      JSON.stringify(input.lastAiActions),
    ],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Exhaustion path (docs/04): ai_last_error set, status stays ai_turn,
 * turn_number untouched, and updated_at = now() gives the failed game a fresh
 * sweep timer — it waits a full minute before sweeping again.
 */
export async function markAiTurnFailed(
  id: string,
  error: string,
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE games SET ai_last_error = $2, updated_at = now()
     WHERE id = $1 AND status = 'ai_turn'`,
    [id, error],
  );
  return (result.rowCount ?? 0) > 0;
}

/** Only the first flip counts: the conditional UPDATE is harmless on repeats (docs/06 ep. 15). */
export async function forfeitGame(id: string): Promise<GameRow | undefined> {
  const { rows } = await pool.query<GameRow>(
    `UPDATE games SET status = 'lost', updated_at = now()
     WHERE id = $1 AND status IN ('player_turn', 'ai_turn')
     RETURNING ${SELECT_COLUMNS}`,
    [id],
  );
  return rows[0];
}
