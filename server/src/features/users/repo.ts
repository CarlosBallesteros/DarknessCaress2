import { pool } from "../../db/pool";
import type { UserRow } from "./types";

const USER_COLUMNS = "id, email, username, password_hash, theme, created_at";

export async function findUserById(id: string): Promise<UserRow | null> {
  const result = await pool.query<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [id]);
  return result.rows[0] ?? null;
}

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const result = await pool.query<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE email = $1`, [
    email,
  ]);
  return result.rows[0] ?? null;
}

export async function findUserByUsername(username: string): Promise<UserRow | null> {
  const result = await pool.query<UserRow>(
    `SELECT ${USER_COLUMNS} FROM users WHERE username = $1`,
    [username],
  );
  return result.rows[0] ?? null;
}

export async function createUser(input: {
  email: string;
  username: string;
  passwordHash: string;
}): Promise<UserRow> {
  const result = await pool.query<UserRow>(
    `INSERT INTO users (email, username, password_hash)
     VALUES ($1, $2, $3)
     RETURNING ${USER_COLUMNS}`,
    [input.email, input.username, input.passwordHash],
  );
  return result.rows[0];
}

export async function updateUsername(id: string, username: string): Promise<UserRow | null> {
  const result = await pool.query<UserRow>(
    `UPDATE users SET username = $2 WHERE id = $1 RETURNING ${USER_COLUMNS}`,
    [id, username],
  );
  return result.rows[0] ?? null;
}

export async function updateTheme(id: string, theme: string): Promise<UserRow | null> {
  const result = await pool.query<UserRow>(
    `UPDATE users SET theme = $2 WHERE id = $1 RETURNING ${USER_COLUMNS}`,
    [id, theme],
  );
  return result.rows[0] ?? null;
}

export async function updateUserProfile(
  id: string,
  updates: { username?: string; theme?: string },
): Promise<UserRow | null> {
  if (updates.username !== undefined && updates.theme !== undefined) {
    const result = await pool.query<UserRow>(
      `UPDATE users SET username = $2, theme = $3 WHERE id = $1 RETURNING ${USER_COLUMNS}`,
      [id, updates.username, updates.theme],
    );
    return result.rows[0] ?? null;
  }
  if (updates.username !== undefined) {
    return updateUsername(id, updates.username);
  }
  if (updates.theme !== undefined) {
    return updateTheme(id, updates.theme);
  }
  return findUserById(id);
}

export async function updatePassword(id: string, passwordHash: string): Promise<void> {
  await pool.query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [id, passwordHash]);
}
