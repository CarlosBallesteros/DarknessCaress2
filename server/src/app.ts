import express from "express";
import cookieParser from "cookie-parser";
import type { NextFunction, Request, Response } from "express";
import { env } from "./env";
import { HttpError } from "./httpError";
import { authRouter } from "./features/auth/router";
import { usersRouter } from "./features/users/router";

export function createServer(): express.Express {
  const app = express();

  app.use(express.json());
  app.use(cookieParser());

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use("/api", authRouter);
  app.use("/api", usersRouter);

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
  createServer().listen(env.PORT, () => {
    console.log(`server listening on port ${env.PORT}`);
  });
}
