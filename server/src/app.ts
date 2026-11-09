import express from "express";
import { pathToFileURL } from "node:url";
import { loadEnv } from "./env.js";
import { wrapAsync } from "./wrap-async.js";

export function createApp(): express.Express {
  const app = express();
  app.get(
    "/api/health",
    wrapAsync(async (_req, res) => {
      res.status(200).json({ ok: true });
    }),
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
