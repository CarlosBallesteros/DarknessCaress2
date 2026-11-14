import cookieParser from "cookie-parser";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { env } from "./env";
import { config } from "./config";
import { authRouter } from "./features/auth/routes";
import { gamesRouter } from "./features/games/routes";
import { metaRouter } from "./features/meta/routes";
import { usersRouter } from "./features/users/routes";
import { wrapAsync } from "./features/wrapAsync";

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

if (require.main === module) {
  app.listen(env.PORT, () => {
    console.log(`Server listening on ${env.PORT}`);
  });
}
