import express from "express";
import cookieParser from "cookie-parser";
import path from "node:path";
import type { NextFunction, Request, Response } from "express";
import { env } from "./env";
import { config } from "./config/load";
import { HttpError } from "./httpError";
import { authRouter } from "./features/auth/router";
import { gamesRouter } from "./features/games/router";
import { meta } from "./features/meta/meta";
import { statsRouter } from "./features/stats/router";
import { usersRouter } from "./features/users/router";
import { sweepStaleJobsAllUsers } from "./features/games/jobs";

// The server-side interval sweep (docs/01): stale-job recovery for ALL users
// on an in-process timer, so a failed background job recovers even when no
// client is polling — async recovery never depends on the browser being open.
// Real-play evidence (v3): the GET-triggered sweep alone left failed jobs
// waiting forever once the owner closed the page. Not cron/queues/external
// machinery (forbidden) — one timer inside the one Express process. Started
// ONLY in the real boot path below (tests drive the sweep explicitly).
function startIntervalSweep(): NodeJS.Timeout {
  const interval = setInterval(() => {
    sweepStaleJobsAllUsers().catch((err: unknown) => {
      console.error("interval sweep failed:", err);
    });
  }, config.ai.sweepIntervalSeconds * 1000);
  interval.unref(); // never hold the process open just for the sweep
  return interval;
}

export function createServer(): express.Express {
  const app = express();

  app.use(express.json());
  app.use(cookieParser());

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/meta", meta);

  app.use("/api", authRouter);
  app.use("/api", usersRouter);
  app.use("/api", statsRouter);
  app.use("/api/games", gamesRouter);

  // Production static serving (docs/01 file description, phase-6 owner-ratified
  // carve-out): the composed stack serves the built SPA from ../client/dist,
  // same origin as the API — no CORS code anywhere. The SPA fallback keeps
  // client routes (/play/:id, /stats, …) alive across a hard refresh; unknown
  // /api paths still answer the contract's 404 body, never the SPA shell.
  if (env.NODE_ENV === "production") {
    const clientDist = path.resolve(__dirname, "../../client/dist");
    app.use(express.static(clientDist));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api")) {
        next(new HttpError(404, "Not found"));
        return;
      }
      res.sendFile(path.join(clientDist, "index.html"));
    });
  }

  // Terminal error middleware: every failure surfaces as the contract's
  // {"error": "<message>"} body. Body-parser syntax errors carry status 400.
  // The 4-arg signature is what makes Express treat this as an error handler.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- _next must exist for the 4-arg error-handler signature
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    const status = (err as { status?: unknown } | null)?.status;
    if (typeof status === "number" && status >= 400) {
      res.status(status).json({ error: (err as Error).message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  });
  return app;
}

// Boots only when run directly; tests import createServer() instead.
if (require.main === module) {
  startIntervalSweep();
  createServer().listen(env.PORT, () => {
    console.log(`server listening on port ${env.PORT}`);
  });
}
