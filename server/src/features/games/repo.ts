import type { Pool, PoolClient } from "pg";
import type { Board, Unit } from "../../game/types.js";
import type { GameRow } from "./dto.js";

export async function countActiveGames(pool: Pool, userId: string): Promise<number> {
  // 06: active/in-progress games only (generating_board, player_turn, ai_turn).
  // Finished games (won/lost) do not count against the concurrency cap.
  const res = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM games
     WHERE user_id = $1
       AND status IN ('generating_board', 'player_turn', 'ai_turn')`,
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

export async function listGamesForUser(pool: Pool, userId: string): Promise<GameRow[]> {
  const res = await pool.query<GameRow>(
    "SELECT * FROM games WHERE user_id = $1 ORDER BY created_at ASC",
    [userId],
  );
  return res.rows;
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

export async function withTransaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback errors
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function findGameForUpdate(
  client: PoolClient,
  id: string,
  userId: string,
): Promise<GameRow | null> {
  const res = await client.query<GameRow>(
    "SELECT * FROM games WHERE id = $1 AND user_id = $2 FOR UPDATE",
    [id, userId],
  );
  return res.rows[0] ?? null;
}

export async function updateGameAfterPlayerMoves(
  client: PoolClient,
  id: string,
  units: Unit[],
  status: "player_turn" | "won",
): Promise<GameRow> {
  const res = await client.query<GameRow>(
    `UPDATE games
     SET units = $2::jsonb,
         status = $3,
         moves_applied = true,
         updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, JSON.stringify(units), status],
  );
  return res.rows[0]!;
}

export async function markMovesAppliedEmpty(client: PoolClient, id: string): Promise<GameRow> {
  const res = await client.query<GameRow>(
    `UPDATE games
     SET moves_applied = true,
         updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id],
  );
  return res.rows[0]!;
}

export async function endPlayerTurn(client: PoolClient, id: string): Promise<GameRow | null> {
  // reset acted flags for ALL units, flip to ai_turn, updated_at now, turn_number unchanged
  const res = await client.query<GameRow>(
    `UPDATE games
     SET status = 'ai_turn',
         moves_applied = false,
         units = (
           SELECT COALESCE(jsonb_agg(jsonb_set(elem, '{acted}', 'false'::jsonb)), '[]'::jsonb)
           FROM jsonb_array_elements(units) AS elem
         ),
         updated_at = now()
     WHERE id = $1 AND status = 'player_turn'
     RETURNING *`,
    [id],
  );
  return res.rows[0] ?? null;
}

export async function forfeitGame(
  pool: Pool,
  id: string,
  userId: string,
): Promise<{ kind: "ok"; row: GameRow } | { kind: "not_found" } | { kind: "finished" }> {
  // Ownership: not belonging => 404. Finished => 409. Any active game forfeitable.
  const rowRes = await pool.query<GameRow>("SELECT * FROM games WHERE id = $1", [id]);
  const row = rowRes.rows[0];
  if (!row || row.user_id !== userId) return { kind: "not_found" };
  if (row.status === "won" || row.status === "lost") return { kind: "finished" };

  const updated = await pool.query<GameRow>(
    `UPDATE games
     SET status = 'lost', updated_at = now()
     WHERE id = $1 AND user_id = $2 AND status NOT IN ('won', 'lost')
     RETURNING *`,
    [id, userId],
  );
  if (updated.rows[0]) {
    return { kind: "ok", row: updated.rows[0] };
  }

  // Raced: re-check final state
  const after = await findGameByIdForUser(pool, id, userId);
  if (!after) return { kind: "not_found" };
  if (after.status === "won" || after.status === "lost") return { kind: "finished" };

  const retry = await pool.query<GameRow>(
    `UPDATE games SET status = 'lost', updated_at = now() WHERE id = $1 AND user_id = $2 AND status NOT IN ('won','lost') RETURNING *`,
    [id, userId],
  );
  if (retry.rows[0]) return { kind: "ok", row: retry.rows[0] };
  const final = await findGameByIdForUser(pool, id, userId);
  if (final && (final.status === "won" || final.status === "lost")) return { kind: "finished" };
  return { kind: "not_found" };
}
