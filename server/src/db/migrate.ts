import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { closePool, getPool } from "./pool.js";

/**
 * Applies schema.sql idempotently (CREATE ... IF NOT EXISTS). tsc does not copy
 * .sql assets into dist/, so the file is read from the package-root `src/` —
 * two levels up resolves to the package root both here and from dist/db/.
 * The production image ships `src/` (server/Dockerfile copies the workspace).
 */
export async function migrate(): Promise<void> {
  const schema = await readFile(
    new URL("../../src/db/schema.sql", import.meta.url),
    "utf8",
  );
  await getPool().query(schema);
}

const isEntry =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntry) {
  migrate()
    .then(() => {
      console.log("migrations applied");
    })
    .catch((err) => {
      console.error("migrations failed:", err);
      process.exitCode = 1;
    })
    .finally(() => closePool());
}
