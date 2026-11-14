import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const composeProjectName = "darknesscaress2";

function composeArgs(files: string[], ...rest: string[]): string[] {
  const args: string[] = ["compose", "--project-directory", repoRoot, "-p", composeProjectName];
  for (const f of files) {
    args.push("-f", f);
  }
  args.push(...rest);
  return args;
}

function loadFiles(tmpDir: string): string[] | null {
  const statePath = path.join(tmpDir, "state.json");
  if (!existsSync(statePath)) return null;
  try {
    const state = JSON.parse(readFileSync(statePath, "utf8")) as { files?: string[] };
    if (Array.isArray(state.files) && state.files.every((f) => typeof f === "string")) {
      return state.files;
    }
  } catch {
    // ignore
  }
  return null;
}

export default async function globalTeardown() {
  const tmpDir = process.env.DC2_E2E_TMPDIR;
  let files: string[] | null = null;

  if (tmpDir) {
    files = loadFiles(tmpDir);
  }

  if (files && files.every((f) => existsSync(f))) {
    console.log("[e2e] tearing down composed stack (volumes preserved)...");
    try {
      execFileSync("docker", composeArgs(files, "down"), {
        cwd: repoRoot,
        stdio: "inherit",
        windowsHide: true,
      });
    } catch (err) {
      console.warn("[e2e] compose down warning:", err);
    }
  } else {
    console.warn("[e2e] no compose state/files found for teardown; skipping compose down");
  }

  if (tmpDir && existsSync(tmpDir)) {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch (err) {
      console.warn("[e2e] failed to remove temp dir:", err);
    }
  }
}
