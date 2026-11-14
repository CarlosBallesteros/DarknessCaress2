import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

function run(cmd: string, args: string[], cwd = repoRoot): string {
  return execFileSync(cmd, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
}

function runInherit(cmd: string, args: string[], cwd = repoRoot): void {
  execFileSync(cmd, args, {
    cwd,
    stdio: "inherit",
    windowsHide: true,
  });
}

const composeProjectName = "darknesscaress2";

function composeArgs(files: string[], ...rest: string[]): string[] {
  const args: string[] = ["compose", "--project-directory", repoRoot, "-p", composeProjectName];
  for (const f of files) {
    args.push("-f", f);
  }
  args.push(...rest);
  return args;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHttpOk(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  let lastErr: unknown = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
      lastErr = new Error(`status ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for ${url}: ${String(lastErr)}`);
}

function resolveDbVolume(files: string[]): string | null {
  try {
    const out = run("docker", composeArgs(files, "config", "--format", "json"));
    const cfg = JSON.parse(out) as {
      volumes?: Record<string, { name?: string } | null>;
    };
    const name = cfg.volumes?.db_data?.name;
    if (name) return name;
  } catch {
    // fall through
  }
  try {
    const ls = run("docker", ["volume", "ls", "-q"]);
    const names = ls
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    const match = names.find((n) => n.endsWith("_db_data") && n.includes("darknesscaress"));
    return match ?? null;
  } catch {
    return null;
  }
}

function adaptBaseCompose(composeYaml: string): string {
  // Remove host port binding for server service to avoid privileged port 80 on Windows.
  // Base compose defines: ports: ["80:3000"]
  let out = composeYaml.replace(
    /^\s*ports:\s*\["80:3000"\]\s*$/m,
    '    ports: ["127.0.0.1:3000:3000"]',
  );
  // env_file path would be resolved relative to temp compose dir; E2E supplies all
  // required server env vars via the e2e override, so drop it to avoid missing-file errors.
  out = out.replace(
    /^\s*env_file:\s*\.env\s*$/m,
    "    # env_file: .env (replaced by e2e override)",
  );
  return out;
}

export default async function globalSetup() {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "dc2-e2e-"));
  const baseComposeSrc = path.join(repoRoot, "docker-compose.yml");
  const overrideComposeSrc = path.join(repoRoot, "docker-compose.override.yml");

  const baseComposePath = path.join(tmpDir, "docker-compose.base.yml");
  const devOverridePath = path.join(tmpDir, "docker-compose.override.yml");
  const e2eOverridePath = path.join(tmpDir, "docker-compose.e2e.yml");
  const statePath = path.join(tmpDir, "state.json");

  const baseYaml = adaptBaseCompose(readFileSync(baseComposeSrc, "utf8"));
  writeFileSync(baseComposePath, baseYaml, "utf8");
  if (existsSync(overrideComposeSrc)) {
    writeFileSync(devOverridePath, readFileSync(overrideComposeSrc, "utf8"), "utf8");
  }

  const e2eOverride = [
    "services:",
    "  server:",
    "    environment:",
    "      DATABASE_URL: postgres://dc:dc@db:5432/darknesscaress",
    "      JWT_SECRET: e2e-test-secret-change-me-64-characters-minimum-ok",
    "      OLLAMA_URL: http://ollama:11434",
    "      OLLAMA_MODEL: qwen2.5:7b-instruct-q4_K_M",
    '      LLM_MOCK: "1"',
    '      PORT: "3000"',
    "      NODE_ENV: production",
    "",
  ].join("\n");
  writeFileSync(e2eOverridePath, e2eOverride, "utf8");

  const files = [baseComposePath];
  if (existsSync(devOverridePath)) files.push(devOverridePath);
  files.push(e2eOverridePath);

  const meta = { files, tmpDir };
  writeFileSync(statePath, JSON.stringify(meta), "utf8");
  process.env.DC2_E2E_TMPDIR = tmpDir;
  process.env.DC2_E2E_STATE = statePath;

  console.log("[e2e] bringing down any existing composed stack (non-destructive)...");
  try {
    runInherit("docker", composeArgs(files, "down"));
  } catch (err) {
    console.warn("[e2e] compose down warning:", err);
  }

  const dbVolume = resolveDbVolume(files);
  if (dbVolume) {
    console.log(`[e2e] removing db volume for clean state: ${dbVolume}`);
    try {
      runInherit("docker", ["volume", "rm", dbVolume]);
    } catch (err) {
      console.warn("[e2e] could not remove db volume (continuing):", err);
    }
  } else {
    console.warn("[e2e] could not resolve db volume name; continuing without explicit removal");
  }

  console.log("[e2e] building and starting db + server (LLM_MOCK=1)...");
  runInherit("docker", composeArgs(files, "up", "-d", "--build", "db", "server"));

  console.log("[e2e] waiting for http://127.0.0.1:3000/api/health ...");
  await waitForHttpOk("http://127.0.0.1:3000/api/health", 180_000);
  console.log("[e2e] stack ready");
}
