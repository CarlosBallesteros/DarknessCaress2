// The one module that owns the games table (docs/01: plain SQL, one small
// module per feature) plus the row→DTO mapper (docs/01 Runtime model:
// snake_case columns → camelCase DTOs). Phase 4 adds creation (endpoint 10's
// generating_board insert) and the board-design job's persistence; phase 5
// extends this with the turn-flow queries.
import { pool } from "../../db/pool";
import { config } from "../../config/load";
import type { Board, Tile, Unit } from "../../game/types";
import type { PoolClient } from "pg";
import type { GameStateDto, GameSummaryDto } from "./dto";

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

export function toGameSummaryDto(row: GameRow): GameSummaryDto {
  return {
    id: row.id,
    difficulty: row.difficulty,
    status: row.status as GameSummaryDto["status"],
    turnNumber: row.turn_number,
    updatedAt: row.updated_at.toISOString(),
    previewBoard: row.board,
    previewUnits: row.units.map((unit) => ({ x: unit.x, y: unit.y, side: unit.side })),
  };
}

// Creation order (docs/06 endpoint 9) — position is the player's mental map,
// never reshuffled by activity; finished games stay in place.
export async function listGamesByUser(userId: string): Promise<GameRow[]> {
  const { rows } = await pool.query<GameRow>(
    `SELECT ${SELECT_COLUMNS} FROM games WHERE user_id = $1 ORDER BY created_at ASC`,
    [userId],
  );
  return rows;
}

/**
 * The turn-flow mutations (endpoints 13–15, docs/06) run under a row lock
 * inside ONE transaction: `SELECT … FOR UPDATE` serializes concurrent
 * submissions, so exactly one bundle can ever be applied per round. The
 * callback throws HttpError for contract failures — rolled back, nothing
 * written — and performs its UPDATE through the same client. Returns null
 * when the game is unknown-or-foreign (the caller answers 404 "Not found").
 */
export async function withGameRowLock<T>(
  userId: string,
  gameId: string,
  fn: (row: GameRow, client: PoolClient) => Promise<T>,
): Promise<T | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<GameRow>(
      `SELECT ${SELECT_COLUMNS} FROM games WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [gameId, userId],
    );
    if (rows.length === 0) {
      await client.query("ROLLBACK");
      return null;
    }
    let result: T;
    try {
      result = await fn(rows[0], client);
    } catch (cause) {
      await client.query("ROLLBACK");
      throw cause;
    }
    await client.query("COMMIT");
    return result;
  } finally {
    client.release();
  }
}

/**
 * The AI-turn job's SUCCESS persist (docs/01 Runtime model): new units,
 * status player_turn | lost (never won — docs/06's status matrix has no
 * ai_turn → won), turn_number + 1 (it advances only on a successful AI
 * turn), last_ai_actions replaced, ai_last_error cleared — under the
 * conditional-persist guard: a forfeit during the thinking wins.
 */
export async function completeAiTurn(
  id: string,
  input: {
    status: "player_turn" | "lost";
    units: Unit[];
    turnNumber: number;
    lastAiActions: unknown;
  },
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE games
     SET status = $2, units = $3, turn_number = $4, last_ai_actions = $5,
         ai_last_error = NULL, updated_at = now()
     WHERE id = $1 AND status = 'ai_turn'`,
    [
      id,
      input.status,
      JSON.stringify(input.units),
      input.turnNumber,
      JSON.stringify(input.lastAiActions),
    ],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * The AI-turn job's FAILURE persist (docs/04): ai_last_error set, status
 * STAYS ai_turn, turn_number unchanged, updated_at = now() gives the row a
 * fresh sweep timer — the stale sweep re-triggers it with a full fresh
 * prompt and retries reset.
 */
export async function markAiTurnFailed(id: string, error: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE games SET ai_last_error = $2, updated_at = now()
     WHERE id = $1 AND status = 'ai_turn'`,
    [id, error],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * The turn endpoints' row patch (docs/06 endpoints 13–15), executed on the
 * transaction's client while the row is locked. Dynamic SET like the users
 * repo — callers pass exactly what changes.
 */
export async function updateTurnState(
  client: PoolClient,
  id: string,
  patch: { status?: string; units?: Unit[]; movesApplied?: boolean },
): Promise<GameRow> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (patch.status !== undefined) {
    values.push(patch.status);
    sets.push(`status = $${values.length}`);
  }
  if (patch.units !== undefined) {
    values.push(JSON.stringify(patch.units));
    sets.push(`units = $${values.length}`);
  }
  if (patch.movesApplied !== undefined) {
    values.push(patch.movesApplied);
    sets.push(`moves_applied = $${values.length}`);
  }
  sets.push("updated_at = now()");
  values.push(id);
  const { rows } = await client.query<GameRow>(
    `UPDATE games SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING ${SELECT_COLUMNS}`,
    values,
  );
  return rows[0];
}

// docs/02: the reset of `acted` happens at turn flips, in feature code —
// endpoint 14 resets BOTH sides' flags in the same stroke that flips the
// status (and resets the round's moves_applied lock).
export function resetActedFlags(units: Unit[]): Unit[] {
  return units.map((unit) => ({ ...unit, acted: false }));
}
