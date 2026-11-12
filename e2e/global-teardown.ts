import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

function composeBase(): string {
  return "docker compose -f docker-compose.yml -f docker-compose.override.yml -f e2e/docker-compose.e2e.yml";
}

export default async function globalTeardown(): Promise<void> {
  // Non-destructive: no -v, volumes preserved.
  execSync(`${composeBase()} down`, {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env,
  });
}
