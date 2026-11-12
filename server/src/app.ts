import path from "node:path";
import express from "express";
import cookieParser from "cookie-parser";
import config from "./config/config.json";
import { env } from "./env";
import { wrapAsync } from "./wrapAsync";

export function createServer() {
  const app = express();

  // Ensure config is loaded at startup (required by phase 1 scaffold).
  void config;

  app.use(express.json());
  app.use(cookieParser());

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  if (env.NODE_ENV === "production") {
    const clientDist = path.resolve(__dirname, "../../client/dist");
    app.use(express.static(clientDist));
    app.get(
      "*",
      wrapAsync(async (_req, res) => {
        res.sendFile(path.join(clientDist, "index.html"));
      }),
    );
  }

  return app;
}

if (require.main === module) {
  const app = createServer();
  app.listen(env.PORT, () => {
    console.log(`Server listening on port ${env.PORT}`);
  });
}
