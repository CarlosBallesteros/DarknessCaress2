// Express app (docs/01). One process does everything; static SPA serving in
// production arrives with the frontend phase (docs/09 phase 6).
import express from "express";
import cookieParser from "cookie-parser";
import type { NextFunction, Request, Response } from "express";
import { HttpError } from "./http-error";
import { config } from "./config/config";
import { createAuthRouter } from "./features/auth/auth.routes";
import { usersRouter } from "./features/users/users.routes";
import { gamesRouter } from "./features/games/games.routes";
import { statsRouter } from "./features/stats/stats.routes";
import { env } from "./env";

export function createApp() {
  const app = express();

  app.use(express.json());
  app.use(cookieParser());

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use("/api/auth", createAuthRouter());
  app.use("/api/me", usersRouter);
  app.use("/api/games", gamesRouter);
  app.use("/api/stats", statsRouter);

  // 7. GET /api/meta — deliberately public: the landing page needs the default
  // theme and the data shown is harmless game metadata (docs/06).
  app.get("/api/meta", (_req, res) => {
    res.json({
      boardSize: config.boardSize,
      maxActiveGames: config.maxActiveGames,
      classes: Object.fromEntries(
        Object.entries(config.classes).map(([key, cls]) => {
          const { label, hp, atk, def, mov, range, role, count, healAmount } =
            cls;
          return [
            key,
            healAmount === undefined
              ? { label, hp, atk, def, mov, range, role, count }
              : { label, hp, atk, def, mov, range, role, count, healAmount },
          ];
        }),
      ),
      personalities: Object.fromEntries(
        Object.entries(config.personalities).map(([key, persona]) => [
          key,
          { label: persona.label },
        ]),
      ),
      themes: config.themes,
      lore: config.lore,
    });
  });

  // One error funnel: contract-shaped bodies for known failures, loud logging
  // (and never a leaking message) for everything else.
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    // Body-parser's malformed-JSON failure carries status 400; keep the
    // contract shape instead of a 500.
    if (
      err instanceof Error &&
      "status" in err &&
      (err as { status?: unknown }).status === 400
    ) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}

// Vitest imports createApp() to exercise the routes against an ephemeral port;
// only a real run should open the configured port.
const app = createApp();
export default app;

if (process.env.NODE_ENV !== "test") {
  app.listen(env.PORT, () => {
    console.log(`Darkness Caress II server listening on port ${env.PORT}`);
  });
}
