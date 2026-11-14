import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../env.js";
import { createPool } from "./pool.js";

export async function runMigrations(databaseUrl: string): Promise<void> {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const schemaPath = path.join(__dirname, "schema.sql");
  const sql = await readFile(schemaPath, "utf8");
  const pool = createPool(databaseUrl);
  try {
    await pool.query(sql);
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const env = loadEnv();
  await runMigrations(env.DATABASE_URL);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main();
}
