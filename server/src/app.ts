import express from "express";
import cookieParser from "cookie-parser";
import { pathToFileURL } from "node:url";
import { loadEnv } from "./env.js";
import { wrapAsync } from "./wrap-async.js";
import { authRouter } from "./features/auth/auth.routes.js";
import { usersRouter } from "./features/users/users.routes.js";
import { metaRouter } from "./features/meta/meta.routes.js";

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
