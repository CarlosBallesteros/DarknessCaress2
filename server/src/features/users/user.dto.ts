/** A row of the users table, as pg returns it (snake_case columns). */
export interface UserRow {
  id: string;
  email: string;
  username: string;
  password_hash: string;
  theme: string;
  created_at: Date;
}

/** Public user shape from 06-api-contract.md. */
export interface UserDTO {
  id: string;
  email: string;
  username: string;
  theme: string;
  createdAt: string;
}

/** One small mapping function per feature converts rows to 06's DTOs (01). */
export function toUserDTO(row: UserRow): UserDTO {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    theme: row.theme,
    createdAt: row.created_at.toISOString(),
  };
}
