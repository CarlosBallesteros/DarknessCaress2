import cookieParser from "cookie-parser";
import express, { type NextFunction, type Request, type Response } from "express";
import bcrypt from "bcrypt";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { config, type AppConfig } from "./config/index.js";
import { createPool } from "./db/pool.js";
import { runMigrations } from "./db/migrate.js";
import { loadEnv } from "./env.js";
import { getLlmClient, type LlmClient } from "./features/ai/llmClient.js";
import { createAuthRouter } from "./features/auth/router.js";
import { createRequireAuth } from "./features/auth/requireAuth.js";
import { createGamesRouter } from "./features/games/router.js";
import { startJobsSweep } from "./features/games/jobs.js";
import { createMetaRouter } from "./features/meta/router.js";
import { createStatsRouter } from "./features/stats/router.js";
import { createUsersRouter } from "./features/users/router.js";
import { wrapAsync } from "./features/wrapAsync.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface ServerOptions {
  pool: pg.Pool;
  jwtSecret: string;
  config: AppConfig;
  llm?: LlmClient;
}

function createBaseApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.get(
    "/api/health",
    wrapAsync((_req, res) => {
      res.status(200).json({ ok: true });
    }),
  );
  return app;
}

export function createServer(options?: ServerOptions) {
  const resolved: ServerOptions | null =
    options ??
    (() => {
      const databaseUrl = process.env.DATABASE_URL;
      const jwtSecret = process.env.JWT_SECRET;
      if (databaseUrl && jwtSecret) {
        return {
          pool: createPool(databaseUrl),
          jwtSecret,
          config,
        };
      }
      return null;
    })();

  if (!resolved) {
    const app = createBaseApp();
    app.use("/api", createMetaRouter(config));
    return app;
  }

  const app = createBaseApp();
  const requireAuth = createRequireAuth(resolved.pool, resolved.jwtSecret);
  const llm = resolved.llm ?? getLlmClient();
  app.use("/api", createMetaRouter(resolved.config));
  app.use("/api", createAuthRouter(resolved.pool, resolved.jwtSecret));
  app.use("/api", createUsersRouter(resolved.pool, resolved.config, requireAuth));
  app.use("/api", createStatsRouter(resolved.pool, resolved.config, requireAuth));
  app.use("/api", createGamesRouter(resolved.pool, resolved.config, requireAuth, llm));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    void err;
    void _next;
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Production SPA: serve built client and fall back to index.html for non-API routes.
  const clientDist = path.resolve(__dirname, "../../client/dist");
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get(/^\/(?!api(?:\/|$)).*/, (_req, res) => {
      res.sendFile(path.join(clientDist, "index.html"));
    });
  }

  return app;
}

async function ensureDefaultUser(pool: pg.Pool): Promise<void> {
  const existing = await pool.query<{ id: string }>(
    "SELECT id FROM users WHERE email = $1 OR username = $2 LIMIT 1",
    ["test@email.com", "Player1"],
  );
  if ((existing.rowCount ?? 0) > 0) return;
  const passwordHash = await bcrypt.hash("12345678", 10);
  try {
    await pool.query(
      "INSERT INTO users (email, username, password_hash) VALUES ($1, $2, $3)",
      ["test@email.com", "Player1", passwordHash],
    );
  } catch (err) {
    // Skipped safely if a conflicting user already exists (race/idempotency).
    const code = (err as { code?: string }).code;
    if (code !== "23505") throw err;
  }
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return entry.endsWith("app.ts") || entry.endsWith("app.js");
}

async function boot(): Promise<void> {
  const env = loadEnv();
  const port = env.PORT;
  const pool = createPool(env.DATABASE_URL);
  await runMigrations(pool);
  await ensureDefaultUser(pool);
  const llm = getLlmClient();
  // Interval sweep for stale background jobs (board design and AI turns).
  startJobsSweep(pool, config, llm);
  const app = createServer({
    pool,
    jwtSecret: env.JWT_SECRET,
    config,
    llm,
  });
  app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });
}

if (isDirectRun()) {
  void boot();
}
