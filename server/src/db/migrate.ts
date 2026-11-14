import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";

function resolveSchemaPath(): string {
  const candidates = [
    path.resolve(__dirname, "schema.sql"),
    // when running compiled output from dist/db, schema.sql lives in src/db
    path.resolve(__dirname, "../../../src/db/schema.sql"),
    path.resolve(__dirname, "../../src/db/schema.sql"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`schema.sql not found (tried: ${candidates.join(", ")})`);
}

export async function runMigrations(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to run migrations");
  }

  const schemaPath = resolveSchemaPath();
  const sql = readFileSync(schemaPath, "utf8");
  const pool = new Pool({ connectionString: databaseUrl });

  try {
    await pool.query(sql);
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  await runMigrations();
  console.log("Migrations applied");
}

if (require.main === module) {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
