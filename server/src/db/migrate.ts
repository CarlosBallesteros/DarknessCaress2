// Migration runner (docs/09 phase 2): applies schema.sql idempotently.
// Run via `npm -w server run migrate` (the deploy runbook in docs/09 phase 7
// uses the same script inside the container, where WORKDIR is /app/server).
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pool } from "./pool";

// tsx runs this file from src/db (schema.sql sits beside it); the compiled
// build lands in dist/db, where the schema stays at src/db.
const candidates = [
  path.join(__dirname, "schema.sql"),
  path.join(__dirname, "../../src/db/schema.sql"),
];
const schemaPath = candidates.find((candidate) => existsSync(candidate));

async function main(): Promise<void> {
  if (!schemaPath) {
    console.error("schema.sql not found relative to", __dirname);
    process.exit(1);
  }
  try {
    const schema = await readFile(schemaPath, "utf8");
    await pool.query(schema);
    console.log(
      `Migrations applied from ${schemaPath} (schema.sql is idempotent).`,
    );
  } finally {
    await pool.end();
  }
}

main();
