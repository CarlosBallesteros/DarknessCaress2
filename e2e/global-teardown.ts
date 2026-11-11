import { compose } from "./helpers/stack";

/**
 * Teardown is NON-DESTRUCTIVE by default: `docker compose down` stops and
 * removes the containers but keeps every named volume (db_data, ollama_data)
 * — game rows and the pulled model survive into the next run. Set
 * E2E_KEEP_STACK=1 to leave the whole stack running behind the teardown.
 */
export default async function globalTeardown(): Promise<void> {
  if (process.env.E2E_KEEP_STACK === "1") {
    console.log("[e2e] E2E_KEEP_STACK=1 — leaving the stack running");
    return;
  }
  console.log("[e2e] docker compose down (volumes preserved)...");
  await compose("down");
}
