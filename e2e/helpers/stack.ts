import { exec } from "node:child_process";
import { fileURLToPath } from "node:url";

/** Monorepo root — every docker compose command runs from here. */
export const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/**
 * The E2E compose invocation: the frozen deploy files plus the suite-only
 * override that remaps the host port and pins the server env (see
 * e2e/docker-compose.e2e.yml for the why). Deploy on the VM is untouched.
 */
export function composeArgs(args: string): string {
  return (
    "docker compose " +
    [
      "-f docker-compose.yml",
      "-f docker-compose.override.yml",
      "-f e2e/docker-compose.e2e.yml",
      args,
    ].join(" ")
  );
}

/** Runs a compose command from the repo root, surfacing stdout/stderr on failure. */
export function compose(args: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(
      composeArgs(args),
      { cwd: REPO_ROOT, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err !== null) {
          err.message = `${stderr.toString().slice(-4000)}\n${stdout.toString().slice(-4000)}`;
          reject(err);
          return;
        }
        resolve(stdout.toString());
      },
    );
  });
}

/**
 * Blocks until GET /api/health answers 200 {"ok":true} through the composed
 * stack (or throws after the budget — the run must not limp on half-alive).
 */
export async function waitUntilHealthy(baseURL: string, budgetMs = 60_000): Promise<void> {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    try {
      const response = await fetch(`${baseURL}/api/health`);
      if (response.ok && ((await response.json()) as { ok?: unknown }).ok === true) {
        return;
      }
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) {
      throw new Error(`stack did not become healthy at ${baseURL}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
