import { getPool } from "../../db/pool.js";
import type { UserRow } from "../users/user.dto.js";

const USER_COLUMNS = "id, email, username, password_hash, theme, created_at";

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const result = await getPool().query<UserRow>(
    `SELECT ${USER_COLUMNS} FROM users WHERE email = $1`,
    [email],
  );
  return result.rows[0] ?? null;
}

export async function insertUser(input: {
  email: string;
  username: string;
  passwordHash: string;
}): Promise<UserRow> {
  const result = await getPool().query<UserRow>(
    `INSERT INTO users (email, username, password_hash)
     VALUES ($1, $2, $3)
     RETURNING ${USER_COLUMNS}`,
    [input.email, input.username, input.passwordHash],
  );
  return result.rows[0];
}

/**
 * A concurrent registration can win the race past the pre-insert checks; map
 * the unique-violation back to the precise 409 message instead of a 500.
 * Constraint names are Postgres defaults: users_email_key / users_username_key.
 */
export function uniqueViolationColumn(
  err: unknown,
): "email" | "username" | null {
  if (
    typeof err !== "object" ||
    err === null ||
    (err as { code?: unknown }).code !== "23505"
  ) {
    return null;
  }
  const constraint = String((err as { constraint?: unknown }).constraint ?? "");
  return constraint.includes("email") ? "email" : "username";
}
