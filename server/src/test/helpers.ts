import { getPool } from "../db/pool.js";
import { ensureTestEnv } from "./env.js";
import { createServer } from "../app.js";

export async function setupDbApp() {
  ensureTestEnv();
  const app = await createServer();
  return app;
}

export async function resetUsers(): Promise<void> {
  const pool = getPool();
  await pool.query("TRUNCATE TABLE users RESTART IDENTITY CASCADE");
}
