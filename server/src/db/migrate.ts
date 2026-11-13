import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { loadEnv } from "../env.js";
import { createPool } from "./pool.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveSchemaPath(): string {
  const candidates = [
    path.join(__dirname, "schema.sql"),
    path.resolve(__dirname, "../../src/db/schema.sql"),
    path.resolve(__dirname, "../../../server/src/db/schema.sql"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`schema.sql not found (looked in: ${candidates.join(", ")})`);
}

export async function runMigrations(pool: pg.Pool): Promise<void> {
  const schemaPath = resolveSchemaPath();
  const sql = fs.readFileSync(schemaPath, "utf8");
  await pool.query(sql);
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  const normalized = entry.replace(/\\/g, "/");
  return normalized.endsWith("/migrate.ts") || normalized.endsWith("/migrate.js");
}

async function main(): Promise<void> {
  const env = loadEnv();
  const pool = createPool(env.DATABASE_URL);
  await runMigrations(pool);
  await pool.end();
  console.log("Migrations applied");
}

if (isDirectRun()) {
  void main();
}
