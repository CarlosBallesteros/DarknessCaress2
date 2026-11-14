import { pool } from "../../db/pool";

export interface UserRow {
  id: string;
  email: string;
  username: string;
  password_hash: string;
  theme: string;
  created_at: Date;
}

export interface UserDto {
  id: string;
  email: string;
  username: string;
  theme: string;
  createdAt: string;
}

export function toUserDto(
  row: Pick<UserRow, "id" | "email" | "username" | "theme" | "created_at">,
): UserDto {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    theme: row.theme,
    createdAt: row.created_at.toISOString(),
  };
}

export async function findUserById(id: string): Promise<UserRow | null> {
  const result = await pool.query<UserRow>(
    "SELECT id, email, username, password_hash, theme, created_at FROM users WHERE id = $1",
    [id],
  );
  return result.rows[0] ?? null;
}

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const result = await pool.query<UserRow>(
    "SELECT id, email, username, password_hash, theme, created_at FROM users WHERE email = $1",
    [email],
  );
  return result.rows[0] ?? null;
}

export function isUniqueViolation(error: unknown): error is { code: string; constraint?: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: string }).code === "23505"
  );
}
