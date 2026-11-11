// The one module that owns the users table (docs/01: plain SQL, one small
// module per feature) plus the row→DTO mapper (docs/01 Runtime model).
import { pool } from "../../db/pool";

export interface UserRow {
  id: string;
  email: string;
  username: string;
  password_hash: string;
  theme: string;
  created_at: Date;
}

// User, as returned everywhere (docs/06 shared DTOs).
export interface UserDto {
  id: string;
  email: string;
  username: string;
  theme: string;
  createdAt: string;
}

export function toUserDto(row: UserRow): UserDto {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    theme: row.theme,
    createdAt: row.created_at.toISOString(),
  };
}

const SELECT_COLUMNS = "id, email, username, password_hash, theme, created_at";

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const { rows } = await pool.query<UserRow>(
    `SELECT ${SELECT_COLUMNS} FROM users WHERE email = $1`,
    [email],
  );
  return rows[0] ?? null;
}

export async function findUserByUsername(
  username: string,
): Promise<UserRow | null> {
  const { rows } = await pool.query<UserRow>(
    `SELECT ${SELECT_COLUMNS} FROM users WHERE username = $1`,
    [username],
  );
  return rows[0] ?? null;
}

export async function findUserById(id: string): Promise<UserRow | null> {
  const { rows } = await pool.query<UserRow>(
    `SELECT ${SELECT_COLUMNS} FROM users WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function createUser(input: {
  email: string;
  username: string;
  passwordHash: string;
}): Promise<UserRow> {
  const { rows } = await pool.query<UserRow>(
    `INSERT INTO users (email, username, password_hash) VALUES ($1, $2, $3)
     RETURNING ${SELECT_COLUMNS}`,
    [input.email, input.username, input.passwordHash],
  );
  return rows[0];
}

export async function updateUser(
  id: string,
  patch: { username?: string; theme?: string },
): Promise<UserRow> {
  const keys = Object.keys(patch) as Array<keyof typeof patch>;
  const setClauses = keys.map((key, index) => `${key} = $${index + 1}`);
  const values = keys.map((key) => patch[key]);
  const { rows } = await pool.query<UserRow>(
    `UPDATE users SET ${setClauses.join(", ")} WHERE id = $${keys.length + 1}
     RETURNING ${SELECT_COLUMNS}`,
    [...values, id],
  );
  return rows[0];
}

export async function updateUserPassword(
  id: string,
  passwordHash: string,
): Promise<void> {
  await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [
    passwordHash,
    id,
  ]);
}
