import { readFileSync } from "node:fs";
import path from "node:path";
import { pool } from "./pool";

// Serialize concurrent runners (parallel test files, two booting processes):
// CREATE EXTENSION IF NOT EXISTS is not race-safe between sessions.
const MIGRATE_LOCK = 424242;

// Runs schema.sql idempotently (every statement is IF NOT EXISTS), so it is
// safe at boot, from tests, and re-run any number of times.
export async function migrate(): Promise<void> {
  const schema = readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATE_LOCK]);
    try {
      await client.query(schema);
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [MIGRATE_LOCK]);
    }
  } finally {
    client.release();
  }
}

if (require.main === module) {
  migrate()
    .then(() => {
      console.log("migrations applied");
      return pool.end();
    })
    .catch((err: unknown) => {
      console.error("migration failed:", err);
      process.exitCode = 1;
    });
}
