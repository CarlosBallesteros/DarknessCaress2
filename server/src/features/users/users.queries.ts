import { getPool } from "../../db/pool.js";
import type { UserRow } from "./user.dto.js";

const USER_COLUMNS = "id, email, username, password_hash, theme, created_at";

export async function findUserById(id: string): Promise<UserRow | null> {
  const result = await getPool().query<UserRow>(
    `SELECT ${USER_COLUMNS} FROM users WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

/** citext makes the comparison case-insensitive; `excludeUserId` lets a user keep their own name. */
export async function findUserByUsername(
  username: string,
  excludeUserId?: string,
): Promise<UserRow | null> {
  const result = excludeUserId
    ? await getPool().query<UserRow>(
        `SELECT ${USER_COLUMNS} FROM users WHERE username = $1 AND id <> $2`,
        [username, excludeUserId],
      )
    : await getPool().query<UserRow>(
        `SELECT ${USER_COLUMNS} FROM users WHERE username = $1`,
        [username],
      );
  return result.rows[0] ?? null;
}

export async function updateUserProfile(
  id: string,
  profile: { username: string; theme: string },
): Promise<UserRow> {
  const result = await getPool().query<UserRow>(
    `UPDATE users SET username = $1, theme = $2 WHERE id = $3 RETURNING ${USER_COLUMNS}`,
    [profile.username, profile.theme, id],
  );
  return result.rows[0];
}

export async function updateUserPassword(
  id: string,
  passwordHash: string,
): Promise<void> {
  await getPool().query("UPDATE users SET password_hash = $1 WHERE id = $2", [
    passwordHash,
    id,
  ]);
}
