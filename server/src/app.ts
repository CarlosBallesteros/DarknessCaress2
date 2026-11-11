import express from "express";
import { env } from "./env";

export function createServer(): express.Express {
  const app = express();

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  return app;
}

// Boots only when run directly; tests import createServer() instead.
if (require.main === module) {
  createServer().listen(env.PORT, () => {
    console.log(`server listening on port ${env.PORT}`);
  });
}
