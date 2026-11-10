import { compose, waitUntilHealthy } from "./helpers/stack";

export function e2eBaseUrl(): string {
  return process.env.E2E_BASE_URL ?? "http://localhost:3000";
}

/**
 * Brings up the REAL composed production stack (docs/01): the image built by
 * the deploy Dockerfile (server + compiled SPA via express.static), db,
 * ollama. The server runs with LLM_MOCK=1 (pinned by
 * e2e/docker-compose.e2e.yml) so AI turns resolve deterministically per
 * docs/04's standalone mode — real-Ollama runs are manual owner checks.
 */
export default async function globalSetup(): Promise<void> {
  console.log("[e2e] docker compose build (production image)...");
  await compose("build");
  console.log("[e2e] starting db...");
  await compose("up -d db");
  console.log("[e2e] migrate (schema.sql is idempotent)...");
  await compose("run --rm server npm run migrate");
  console.log("[e2e] compose up -d (server + db + ollama)...");
  await compose("up -d");
  await waitUntilHealthy(e2eBaseUrl());
  console.log(`[e2e] stack healthy at ${e2eBaseUrl()}`);
}
