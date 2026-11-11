import { pool } from "../../db/pool";

export interface UserRow {
  id: string;
  email: string;
  username: string;
  password_hash: string;
  theme: string;
  created_at: Date;
}

// Public shape per docs/06's shared User DTO.
export interface UserDto {
  id: string;
  email: string;
  username: string;
  theme: string;
  createdAt: string;
}

// Row→DTO mapping per docs/01 (snake_case columns, camelCase DTOs).
export function toUserDto(row: UserRow): UserDto {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    theme: row.theme,
    createdAt: row.created_at.toISOString(),
  };
}

export async function insertUser(
  email: string,
  username: string,
  passwordHash: string,
): Promise<UserRow> {
  const { rows } = await pool.query<UserRow>(
    "INSERT INTO users (email, username, password_hash) VALUES ($1, $2, $3) RETURNING *",
    [email, username, passwordHash],
  );
  return rows[0];
}

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const { rows } = await pool.query<UserRow>("SELECT * FROM users WHERE email = $1", [email]);
  return rows[0] ?? null;
}

export async function findUserByUsername(username: string): Promise<UserRow | null> {
  const { rows } = await pool.query<UserRow>("SELECT * FROM users WHERE username = $1", [username]);
  return rows[0] ?? null;
}

export async function findUserById(id: string): Promise<UserRow | null> {
  const { rows } = await pool.query<UserRow>("SELECT * FROM users WHERE id = $1", [id]);
  return rows[0] ?? null;
}

// Caller guarantees at least one key (the route enforces "at least one present").
export async function updateUser(
  id: string,
  patch: { username?: string; theme?: string },
): Promise<UserRow> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (patch.username !== undefined) {
    values.push(patch.username);
    sets.push(`username = $${values.length}`);
  }
  if (patch.theme !== undefined) {
    values.push(patch.theme);
    sets.push(`theme = $${values.length}`);
  }
  values.push(id);
  const { rows } = await pool.query<UserRow>(
    `UPDATE users SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING *`,
    values,
  );
  return rows[0];
}

export async function updatePasswordHash(id: string, passwordHash: string): Promise<void> {
  await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [passwordHash, id]);
}
