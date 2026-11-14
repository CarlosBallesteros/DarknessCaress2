import cookieParser from "cookie-parser";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { env } from "./env";
import { config } from "./config";
import { authRouter } from "./features/auth/routes";
import { gamesRouter } from "./features/games/routes";
import { metaRouter } from "./features/meta/routes";
import { statsRouter } from "./features/stats/routes";
import { usersRouter } from "./features/users/routes";
import { wrapAsync } from "./features/wrapAsync";
import { sweepAllStaleJobs } from "./features/games/staleRecovery";

export function createApp(): Express {
  // Config is loaded once at module initialization (server/src/config/index.ts).
  void config;

  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use(cookieParser());

  app.get(
    "/api/health",
    wrapAsync(async (_req, res) => {
      res.status(200).json({ ok: true });
    }),
  );

  app.use(authRouter);
  app.use(usersRouter);
  app.use(metaRouter);
  app.use(gamesRouter);
  app.use(statsRouter);

  if (env.NODE_ENV === "production") {
    const clientDist = path.resolve(__dirname, "../../client/dist");
    if (fs.existsSync(clientDist)) {
      app.use(express.static(clientDist));
      app.get("*", (_req, res) => {
        res.sendFile(path.join(clientDist, "index.html"));
      });
    }
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    void err;
    void _next;
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}

export const app = createApp();
export const createServer = createApp;

let sweepTimer: NodeJS.Timeout | null = null;

export function startIntervalSweep(): void {
  if (sweepTimer) return;
  const intervalMs = Math.max(1, config.ai.sweepIntervalSeconds) * 1000;
  sweepTimer = setInterval(() => {
    void sweepAllStaleJobs().catch((err) => {
      console.error("stale sweep error", err);
    });
  }, intervalMs);
  // do not keep process alive only for sweep in tests/tools contexts? in server it's fine
  if (typeof sweepTimer.unref === "function") {
    sweepTimer.unref();
  }
}

async function ensureDefaultUser(): Promise<void> {
  const { pool } = await import("./db/pool");
  const { hashPassword } = await import("./features/auth/passwords");
  // idempotent seed: test@email.com / Player1 / 12345678, bcrypt cost 10
  const existing = await pool.query("SELECT id FROM users WHERE email = $1 OR username = $2", [
    "test@email.com",
    "Player1",
  ]);
  if ((existing.rowCount ?? 0) > 0) {
    return;
  }
  const passwordHash = await hashPassword("12345678");
  try {
    await pool.query(`INSERT INTO users (email, username, password_hash) VALUES ($1, $2, $3)`, [
      "test@email.com",
      "Player1",
      passwordHash,
    ]);
  } catch (err) {
    // conflicting user may have appeared concurrently; safe to skip
    const code = (err as { code?: string }).code;
    if (code !== "23505") throw err;
  }
}

export async function boot(): Promise<void> {
  const { runMigrations } = await import("./db/migrate");
  await runMigrations();
  await ensureDefaultUser();
  startIntervalSweep();
  app.listen(env.PORT, () => {
    console.log(`Server listening on ${env.PORT}`);
  });
}

if (require.main === module) {
  void boot().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
