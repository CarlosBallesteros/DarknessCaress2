import cookieParser from "cookie-parser";
import express, { type NextFunction, type Request, type Response } from "express";
import type pg from "pg";
import { config, type AppConfig } from "./config/index.js";
import { createPool } from "./db/pool.js";
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

  return app;
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return entry.endsWith("app.ts") || entry.endsWith("app.js");
}

if (isDirectRun()) {
  const env = loadEnv();
  const port = env.PORT;
  const pool = createPool(env.DATABASE_URL);
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
