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

export function toUserDto(row: UserRow): UserDto {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    theme: row.theme,
    createdAt: row.created_at.toISOString(),
  };
}
