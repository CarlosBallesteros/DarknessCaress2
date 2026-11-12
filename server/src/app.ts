import express from "express";
import path from "node:path";
import bcrypt from "bcrypt";
import { config } from "./config";
import { loadEnv } from "./env";
import { pool } from "./db/pool";
import { runMigrations } from "./db/migrate";
import { wrapAsync } from "./wrapAsync";
import authRouter from "./features/auth/router";
import usersRouter from "./features/users/router";
import gamesRouter from "./features/games/router";
import aiRouter from "./features/ai/router";
import boardRouter from "./features/board/router";
import statsRouter from "./features/stats/router";
import metaRouter from "./features/meta/router";

export function createServer() {
  const app = express();
  app.use(express.json());

  app.get(
    "/api/health",
    wrapAsync(async (_req, res) => {
      res.status(200).json({ ok: true });
    }),
  );

  app.use("/api/auth", authRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/games", gamesRouter);
  app.use("/api/ai", aiRouter);
  app.use("/api/board", boardRouter);
  app.use("/api/stats", statsRouter);
  app.use("/api/meta", metaRouter);

  if (process.env.NODE_ENV === "production") {
    app.use(express.static(path.join(__dirname, "../client/dist")));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(__dirname, "../client/dist/index.html"));
    });
  }

  return app;
}

async function ensureDefaultUser(): Promise<void> {
  const existing = await pool.query("SELECT id FROM users WHERE email = $1 OR username = $2", [
    "test@email.com",
    "Player1",
  ]);
  if ((existing.rowCount ?? 0) > 0) return;
  const passwordHash = await bcrypt.hash("12345678", 10);
  await pool.query("INSERT INTO users (email, username, password_hash) VALUES ($1, $2, $3)", [
    "test@email.com",
    "Player1",
    passwordHash,
  ]);
}

let sweepTimer: NodeJS.Timeout | null = null;

function startSweep(): void {
  const intervalMs = Number(config.ai.sweepIntervalSeconds) * 1000;
  sweepTimer = setInterval(async () => {
    try {
      await sweep();
    } catch {
      // Sweep failures must never kill the process.
    }
  }, intervalMs);
  sweepTimer.unref?.();
}

async function sweep(): Promise<void> {
  // Phase 1 placeholder: the interval sweep is started at boot; full job
  // recovery logic lands in phase 5. Intentionally empty here.
}

async function boot(): Promise<void> {
  loadEnv();
  await runMigrations();
  await ensureDefaultUser();
  startSweep();
  const port = Number(process.env.PORT) || 3000;
  createServer().listen(port, () => {
    console.log(`server listening on :${port}`);
  });
}

if (require.main === module) {
  boot().catch((err) => {
    console.error("boot failed:", err);
    process.exit(1);
  });
}
