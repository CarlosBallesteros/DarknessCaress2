import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

function run(cmd: string): void {
  execSync(cmd, {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env,
  });
}

function composeBase(): string {
  return "docker compose -f docker-compose.yml -f docker-compose.override.yml -f e2e/docker-compose.e2e.yml";
}

async function waitForHealth(url: string, timeoutMs = 180000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Timed out waiting for health at ${url}`);
}

export default async function globalSetup(): Promise<void> {
  const compose = composeBase();
  run(`${compose} down`);
  run(`${compose} up -d --build db`);
  // wait for db healthcheck
  run(`${compose} exec -T db sh -lc "until pg_isready -U dc -d darknesscaress; do sleep 1; done"`);
  // migrations (idempotent)
  run(`${compose} run --rm --no-deps server npm run migrate`);
  run(`${compose} up -d --build server`);
  await waitForHealth("http://localhost:3000/api/health");
}
