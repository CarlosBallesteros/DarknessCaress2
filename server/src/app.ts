import express from "express";
import { config } from "./config/index.js";
import { wrapAsync } from "./features/wrapAsync.js";

export function createServer() {
  // Ensure config is loaded as part of server startup.
  void config;

  const app = express();
  app.use(express.json());

  app.get(
    "/api/health",
    wrapAsync((_req, res) => {
      res.status(200).json({ ok: true });
    }),
  );

  return app;
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return entry.endsWith("app.ts") || entry.endsWith("app.js");
}

if (isDirectRun()) {
  const port = Number(process.env.PORT ?? 3000);
  const app = createServer();
  app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });
}
