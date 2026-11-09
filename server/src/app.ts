import express from "express";
import cookieParser from "cookie-parser";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadEnv } from "./env.js";
import { wrapAsync } from "./wrap-async.js";
import { authRouter } from "./features/auth/auth.routes.js";
import { usersRouter } from "./features/users/users.routes.js";
import { metaRouter } from "./features/meta/meta.routes.js";
import { gamesRouter } from "./features/games/games.routes.js";
import { statsRouter } from "./features/stats/stats.routes.js";

export function createApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.get(
    "/api/health",
    wrapAsync(async (_req, res) => {
      res.status(200).json({ ok: true });
    }),
  );
  app.use("/api", metaRouter);
  app.use("/api/auth", authRouter);
  app.use("/api", usersRouter);
  app.use("/api", gamesRouter);
  app.use("/api", statsRouter);
  // Production serves the built SPA from ../client/dist (01): static files,
  // then a fallback to index.html for client-side routes. /api keeps its own
  // 404s — the fallback must not swallow them as HTML.
  if (process.env.NODE_ENV === "production") {
    const distDir = fileURLToPath(
      new URL("../../client/dist", import.meta.url),
    );
    if (existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get("*", (req, res, next) => {
        if (req.path.startsWith("/api")) {
          next();
          return;
        }
        res.sendFile(path.join(distDir, "index.html"));
      });
    }
  }
  // Keeps every error response in 06's {"error": ...} shape — notably
  // malformed-JSON bodies, which body-parser reports as a 400 with status.
  app.use(
    (
      err: unknown,
      req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      if (res.headersSent) {
        next(err);
        return;
      }
      const status = (err as { status?: unknown }).status;
      if (typeof status === "number" && status >= 400 && status < 500) {
        res.status(status).json({ error: "Malformed request body" });
        return;
      }
      console.error(err);
      res.status(500).json({ error: "Internal server error" });
    },
  );
  return app;
}

const isEntry =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntry) {
  const env = loadEnv();
  createApp().listen(env.PORT, () => {
    console.log(`server listening on port ${env.PORT}`);
  });
}
