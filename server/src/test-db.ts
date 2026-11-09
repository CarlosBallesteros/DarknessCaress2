import { afterAll, beforeAll } from "vitest";
import { closePool } from "./db/pool.js";
import { migrate } from "./db/migrate.js";

/**
 * Registers beforeAll/afterAll so a test file runs against a migrated
 * database and closes its pool (an open pool would keep vitest alive).
 */
export function useTestDb(): void {
  beforeAll(async () => {
    await migrate();
  });
  afterAll(async () => {
    await closePool();
  });
}
