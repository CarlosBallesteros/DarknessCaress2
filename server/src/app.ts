import cookieParser from "cookie-parser";
import express, { type Express } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config/index.js";
import { loadEnv } from "./env.js";
import { createPool, setPool } from "./db/pool.js";
import { runMigrations } from "./db/migrate.js";
import { createAuthRouter } from "./features/auth/routes.js";
import { usersRouter } from "./features/users/routes.js";
import { metaRouter } from "./features/meta/routes.js";
import { wrapAsync } from "./features/wrapAsync.js";

export async function createServer(): Promise<Express> {
  await loadConfig();
  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  app.get(
    "/api/health",
    wrapAsync((_req, res) => {
      res.status(200).json({ ok: true });
    }),
  );

  app.use("/api/auth", createAuthRouter());
  app.use("/api", usersRouter);
  app.use("/api/meta", metaRouter);

  if (process.env.NODE_ENV === "production") {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const clientDist = path.resolve(__dirname, "../../client/dist");
    app.use(express.static(clientDist));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(clientDist, "index.html"));
    });
  }

  return app;
}

async function main(): Promise<void> {
  const env = loadEnv();
  setPool(createPool(env.DATABASE_URL));
  await runMigrations(env.DATABASE_URL);
  const app = await createServer();
  app.listen(env.PORT, () => {
    console.log(`Server listening on port ${env.PORT}`);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
