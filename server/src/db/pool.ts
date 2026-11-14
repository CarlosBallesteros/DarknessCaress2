import pg from "pg";

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function createPool(connectionString: string): pg.Pool {
  return new Pool({ connectionString });
}

export function setPool(nextPool: pg.Pool): void {
  pool = nextPool;
}

export function getPool(): pg.Pool {
  if (!pool) {
    throw new Error("Database pool not initialized");
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
