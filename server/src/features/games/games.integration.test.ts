import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { config } from "../../config/index.js";
import { createPool } from "../../db/pool.js";
import { createServer } from "../../app.js";
import type { LlmClient } from "../ai/llmClient.js";
import { briefFixture } from "../ai/mockLlm.js";

function loadDotEnv(): void {
  if (process.env.DATABASE_URL && process.env.JWT_SECRET) return;
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const candidates = [
    path.resolve(__dirname, "../../../../.env"),
    path.resolve(__dirname, "../../../.env"),
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "../.env"),
  ];
  const envPath = candidates.find((p) => fs.existsSync(p));
  if (!envPath) return;
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1);
    const hash = value.indexOf(" #");
    if (hash !== -1) value = value.slice(0, hash);
    value = value.trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadDotEnv();

const databaseUrl = process.env.DATABASE_URL;
const jwtSecret = process.env.JWT_SECRET ?? "test-secret";
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for integration tests");
}

const pool = createPool(databaseUrl);

async function applySchema(): Promise<void> {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const schemaPath = path.resolve(__dirname, "../../db/schema.sql");
  const sql = fs.readFileSync(schemaPath, "utf8");
  await pool.query(sql);
}

const mockLlm: LlmClient = {
  async chat() {
    return briefFixture;
  },
  async brief() {
    return JSON.parse(JSON.stringify(briefFixture));
  },
  async turn() {
    throw new Error("stub");
  },
};

function makeApp() {
  return createServer({ pool, jwtSecret, config, llm: mockLlm });
}

function cookieFrom(res: request.Response): string {
  const set = res.headers["set-cookie"];
  const arr = Array.isArray(set) ? set : set ? [set] : [];
  const found = arr.find((c) => c.startsWith("dc_session="));
  if (!found) throw new Error("dc_session cookie not set");
  return found.split(";")[0];
}

async function registerAndLogin(app: ReturnType<typeof makeApp>, suffix: string) {
  const reg = await request(app)
    .post("/api/auth/register")
    .send({
      email: `user${suffix}@example.com`,
      password: "password123",
      username: `user${suffix}`,
    });
  expect(reg.status).toBe(201);
  return cookieFrom(reg);
}

async function waitForPlayerTurn(
  app: ReturnType<typeof makeApp>,
  cookie: string,
  gameId: string,
  timeoutMs = 15000,
): Promise<request.Response> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await request(app).get(`/api/games/${gameId}`).set("Cookie", [cookie]);
    if (res.status === 200 && res.body?.game?.status === "player_turn") {
      return res;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Timed out waiting for game ${gameId} to reach player_turn`);
}

describe("phase 4 games endpoints", () => {
  beforeAll(async () => {
    await applySchema();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM games");
    await pool.query("DELETE FROM users");
  });

  afterAll(async () => {
    await pool.end();
  });

  it("mock-LLM full flow: POST 202 generating_board -> background job -> GET player_turn with armies", async () => {
    const app = makeApp();
    const cookie = await registerAndLogin(app, "flow");

    const created = await request(app)
      .post("/api/games")
      .set("Cookie", [cookie])
      .send({ difficulty: "aggressive" });

    expect(created.status).toBe(202);
    expect(created.body.game.status).toBe("generating_board");
    expect(created.body.game.turnNumber).toBe(1);
    expect(created.body.game.units).toEqual([]);
    expect(created.body.game.board.tiles).toHaveLength(config.boardSize);
    for (const row of created.body.game.board.tiles) {
      expect(row).toHaveLength(config.boardSize);
      for (const t of row) expect(t).toBe("plain");
    }

    const ready = await waitForPlayerTurn(app, cookie, created.body.game.id);
    expect(ready.body.game.status).toBe("player_turn");
    expect(ready.body.game.units).toHaveLength(20);
    // armies placed per spawn layout: 10 per side in reserved rows
    const players = ready.body.game.units.filter((u: { side: string }) => u.side === "player");
    const enemies = ready.body.game.units.filter((u: { side: string }) => u.side === "enemy");
    expect(players).toHaveLength(10);
    expect(enemies).toHaveLength(10);
    for (const u of players) {
      expect([config.boardSize - 2, config.boardSize - 1]).toContain(u.y);
    }
    for (const u of enemies) {
      expect([0, 1]).toContain(u.y);
    }
    // board is no longer all-plain placeholder in general (should have terrain/features from brief/fallback materialization)
    expect(ready.body.game.board.tiles).toHaveLength(config.boardSize);
  });

  it("409 on 6th active game (generating_board counts as active)", async () => {
    const app = makeApp();
    const cookie = await registerAndLogin(app, "cap");

    for (let i = 0; i < config.maxActiveGames; i++) {
      const res = await request(app)
        .post("/api/games")
        .set("Cookie", [cookie])
        .send({ difficulty: "aggressive" });
      expect(res.status).toBe(202);
      expect(res.body.game.status).toBe("generating_board");
    }

    const sixth = await request(app)
      .post("/api/games")
      .set("Cookie", [cookie])
      .send({ difficulty: "aggressive" });
    expect(sixth.status).toBe(409);
    expect(sixth.body).toEqual({ error: `Active game limit reached (${config.maxActiveGames})` });
  });
});
