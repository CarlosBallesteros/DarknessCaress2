import { getPool } from "../../db/pool.js";
import type { Unit } from "../../game/types.js";
import type { GameRow } from "./game.dto.js";

const GAME_COLUMNS =
  "id, user_id, difficulty, status, board, units, turn_number, ai_last_error, used_fallback, last_ai_actions, moves_applied, created_at, updated_at";

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

/** The AI job loads by id alone — it is internal, not user-scoped (01). */
export async function getGameById(id: string): Promise<GameRow | undefined> {
  const result = await getPool().query<GameRow>(
    `SELECT ${GAME_COLUMNS} FROM games WHERE id = $1`,
    [id],
  );
  return result.rows[0];
}

/** Every game reference is owned by the caller; unknown-or-foreign reads 404 (06). */
export async function getGameByUser(
  userId: string,
  id: string,
): Promise<GameRow | undefined> {
  const result = await getPool().query<GameRow>(
    `SELECT ${GAME_COLUMNS} FROM games WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  return result.rows[0];
}

/** Creation order is the player's mental map — never reshuffled (06 ep. 9). */
export async function listGamesByUser(userId: string): Promise<GameRow[]> {
  const result = await getPool().query<GameRow>(
    `SELECT ${GAME_COLUMNS} FROM games WHERE user_id = $1 ORDER BY created_at ASC, id ASC`,
    [userId],
  );
  return result.rows;
}

/**
 * Endpoint 13's atomic apply (06): one conditional UPDATE persists the applied
 * bundle. `AND NOT moves_applied` makes the once-per-round lock race-proof —
 * a concurrent second submission finds zero rows and is answered 409. An empty
 * bundle takes the same path ("applies nothing, consumes the budget"), which
 * is exactly what keeps the lock restart-proof (01's moves_applied column).
 */
export async function applyPlayerMoves(
  id: string,
  units: Unit[],
  status: "player_turn" | "won" | "lost",
): Promise<GameRow | undefined> {
  const result = await getPool().query<GameRow>(
    `UPDATE games
     SET units = $2, status = $3, moves_applied = true, updated_at = now()
     WHERE id = $1 AND status = 'player_turn' AND moves_applied = false
     RETURNING ${GAME_COLUMNS}`,
    [id, JSON.stringify(units), status],
  );
  return result.rows[0];
}

/**
 * Endpoint 14's single stroke: status flips to ai_turn, BOTH armies' acted
 * flags reset, and the round's moves lock clears — turnNumber unchanged (06).
 */
export async function beginAiTurn(
  id: string,
  resetUnits: Unit[],
): Promise<GameRow | undefined> {
  const result = await getPool().query<GameRow>(
    `UPDATE games
     SET status = 'ai_turn', units = $2, moves_applied = false, updated_at = now()
     WHERE id = $1 AND status = 'player_turn'
     RETURNING ${GAME_COLUMNS}`,
    [id, JSON.stringify(resetUnits)],
  );
  return result.rows[0];
}

/** The victory short-circuit at end-turn: all enemies dead ⇒ won, no AI turn (06 ep. 14). */
export async function endTurnWon(id: string): Promise<GameRow | undefined> {
  const result = await getPool().query<GameRow>(
    `UPDATE games SET status = 'won', updated_at = now()
     WHERE id = $1 AND status = 'player_turn'
     RETURNING ${GAME_COLUMNS}`,
    [id],
  );
  return result.rows[0];
}

/**
 * A successful AI turn persists CONDITIONALLY (01): `WHERE status = 'ai_turn'`
 * discards the result when the game left ai_turn meanwhile (a forfeit during
 * thinking). turn_number advances ONLY here — the 1-based current round (06).
 */
export async function applyAiTurnResult(
  id: string,
  input: {
    status: "player_turn" | "lost";
    units: Unit[];
    lastAiActions: unknown;
  },
): Promise<boolean> {
  const result = await getPool().query(
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
 * Exhaustion path (04): ai_last_error set, status stays ai_turn, turn_number
 * untouched, and updated_at = now() gives a failed game a fresh sweep timer.
 */
export async function markAiTurnFailed(
  id: string,
  error: string,
): Promise<boolean> {
  const result = await getPool().query(
    `UPDATE games SET ai_last_error = $2, updated_at = now()
     WHERE id = $1 AND status = 'ai_turn'`,
    [id, error],
  );
  return (result.rowCount ?? 0) > 0;
}

/** Only the first flip counts: the conditional UPDATE is harmless on repeats (06 ep. 15). */
export async function forfeitGame(id: string): Promise<GameRow | undefined> {
  const result = await getPool().query<GameRow>(
    `UPDATE games SET status = 'lost', updated_at = now()
     WHERE id = $1 AND status IN ('player_turn', 'ai_turn')
     RETURNING ${GAME_COLUMNS}`,
    [id],
  );
  return result.rows[0];
}
