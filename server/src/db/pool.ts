import pg from "pg";

let pool: pg.Pool | undefined;

function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return url;
}

/**
 * Lazily created shared pg Pool. `loadEnv()` already validated DATABASE_URL at
 * boot; tests seed the variable in their setup file before importing this.
 */
export function getPool(): pg.Pool {
  pool ??= new pg.Pool({ connectionString: databaseUrl() });
  return pool;
}

export async function closePool(): Promise<void> {
  if (!pool) return;
  await pool.end();
  pool = undefined;
}
