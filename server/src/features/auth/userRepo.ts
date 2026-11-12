import type { Pool } from "pg";

export interface UserRow {
  id: string;
  email: string;
  username: string;
  password_hash: string;
  theme: string;
  created_at: Date;
}

export interface PublicUser {
  id: string;
  email: string;
  username: string;
  theme: string;
  createdAt: string;
}

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    theme: row.theme,
    createdAt: row.created_at.toISOString(),
  };
}

export async function findUserByEmail(pool: Pool, email: string): Promise<UserRow | null> {
  const result = await pool.query<UserRow>(
    "SELECT id, email::text AS email, username::text AS username, password_hash, theme, created_at FROM users WHERE email = $1",
    [email],
  );
  return result.rows[0] ?? null;
}

export async function findUserById(pool: Pool, id: string): Promise<UserRow | null> {
  const result = await pool.query<UserRow>(
    "SELECT id, email::text AS email, username::text AS username, password_hash, theme, created_at FROM users WHERE id = $1",
    [id],
  );
  return result.rows[0] ?? null;
}

export async function createUser(
  pool: Pool,
  params: { email: string; username: string; passwordHash: string },
): Promise<UserRow> {
  const result = await pool.query<UserRow>(
    `INSERT INTO users (email, username, password_hash)
     VALUES ($1, $2, $3)
     RETURNING id, email::text AS email, username::text AS username, password_hash, theme, created_at`,
    [params.email, params.username, params.passwordHash],
  );
  return result.rows[0];
}

export async function updateUsername(
  pool: Pool,
  userId: string,
  username: string,
): Promise<UserRow> {
  const result = await pool.query<UserRow>(
    `UPDATE users SET username = $2 WHERE id = $1
     RETURNING id, email::text AS email, username::text AS username, password_hash, theme, created_at`,
    [userId, username],
  );
  return result.rows[0];
}

export async function updateTheme(pool: Pool, userId: string, theme: string): Promise<UserRow> {
  const result = await pool.query<UserRow>(
    `UPDATE users SET theme = $2 WHERE id = $1
     RETURNING id, email::text AS email, username::text AS username, password_hash, theme, created_at`,
    [userId, theme],
  );
  return result.rows[0];
}

export async function updatePasswordHash(
  pool: Pool,
  userId: string,
  passwordHash: string,
): Promise<void> {
  await pool.query("UPDATE users SET password_hash = $2 WHERE id = $1", [userId, passwordHash]);
}
