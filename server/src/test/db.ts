import { pool } from "../db/pool";

export async function resetDb() {
  await pool.query("TRUNCATE TABLE games, users RESTART IDENTITY CASCADE");
}
