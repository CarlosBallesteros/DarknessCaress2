import cookieParser from "cookie-parser";
import express, { type Express } from "express";
import fs from "node:fs";
import path from "node:path";
import { env } from "./env";
import { config } from "./config";
import { wrapAsync } from "./features/wrapAsync";

export function createApp(): Express {
  // Config is loaded once at module initialization (server/src/config/index.ts).
  void config;

  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  app.get(
    "/api/health",
    wrapAsync(async (_req, res) => {
      res.status(200).json({ ok: true });
    }),
  );

  if (env.NODE_ENV === "production") {
    const clientDist = path.resolve(__dirname, "../../client/dist");
    if (fs.existsSync(clientDist)) {
      app.use(express.static(clientDist));
      app.get("*", (_req, res) => {
        res.sendFile(path.join(clientDist, "index.html"));
      });
    }
  }

  return app;
}

export const app = createApp();

if (require.main === module) {
  app.listen(env.PORT, () => {
    console.log(`Server listening on ${env.PORT}`);
  });
}
