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
import { sweepStaleJobs } from "./jobs.js";

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
      email: `p5${suffix}@example.com`,
      password: "password123",
      username: `p5${suffix}`,
    });
  expect(reg.status).toBe(201);
  return cookieFrom(reg);
}

async function waitForStatus(
  app: ReturnType<typeof makeApp>,
  cookie: string,
  gameId: string,
  status: string,
  timeoutMs = 15000,
): Promise<request.Response> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await request(app).get(`/api/games/${gameId}`).set("Cookie", [cookie]);
    if (res.status === 200 && res.body?.game?.status === status) {
      return res;
    }
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error(`Timed out waiting for game ${gameId} to reach ${status}`);
}

async function waitForPlayerOrLost(
  app: ReturnType<typeof makeApp>,
  cookie: string,
  gameId: string,
  timeoutMs = 15000,
): Promise<request.Response> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await request(app).get(`/api/games/${gameId}`).set("Cookie", [cookie]);
    if (
      res.status === 200 &&
      (res.body?.game?.status === "player_turn" || res.body?.game?.status === "lost")
    ) {
      return res;
    }
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error(`Timed out waiting for game ${gameId} to reach player_turn/lost`);
}

describe("phase 5: AI turns & remaining API", () => {
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

  it("server-side move loop: create → POST moves → end-turn → policy job applies enemy moves → player_turn/lost, turn advances, lastAiActions populated, ai_last_error cleared", async () => {
    const app = makeApp();
    const cookie = await registerAndLogin(app, "loop");

    const created = await request(app)
      .post("/api/games")
      .set("Cookie", [cookie])
      .send({ difficulty: "aggressive" });
    expect(created.status).toBe(202);

    const ready = await waitForStatus(app, cookie, created.body.game.id, "player_turn");
    expect(ready.body.game.turnNumber).toBe(1);
    expect(ready.body.game.lastAiActions).toBeNull();

    // submit empty moves bundle (valid, consumes round)
    const moved = await request(app)
      .post(`/api/games/${created.body.game.id}/moves`)
      .set("Cookie", [cookie])
      .send({ moves: [] });
    expect(moved.status).toBe(200);
    expect(moved.body.game.status).toBe("player_turn");

    const ended = await request(app)
      .post(`/api/games/${created.body.game.id}/end-turn`)
      .set("Cookie", [cookie])
      .send();
    expect(ended.status).toBe(200);
    expect(ended.body.game.status).toBe("ai_turn");

    const afterAi = await waitForPlayerOrLost(app, cookie, created.body.game.id);
    expect(["player_turn", "lost"]).toContain(afterAi.body.game.status);
    if (afterAi.body.game.status === "player_turn") {
      expect(afterAi.body.game.turnNumber).toBe(2);
      expect(Array.isArray(afterAi.body.game.lastAiActions)).toBe(true);
      expect(afterAi.body.game.lastAiActions.length).toBeGreaterThan(0);
    }
    // ai_last_error cleared on success (not exposed in DTO, but verify via DB)
    const db = await pool.query("SELECT ai_last_error FROM games WHERE id = $1", [
      created.body.game.id,
    ]);
    expect(db.rows[0].ai_last_error).toBeNull();
  });

  it("illegal player bundle → 400 with exact message and move N prefix; DB untouched and failed attempt leaves round unlocked; second applied submission → 409", async () => {
    const app = makeApp();
    const cookie = await registerAndLogin(app, "moves");

    const created = await request(app)
      .post("/api/games")
      .set("Cookie", [cookie])
      .send({ difficulty: "aggressive" });
    const ready = await waitForStatus(app, cookie, created.body.game.id, "player_turn");
    const gameId = created.body.game.id;
    const units = ready.body.game.units as Array<{
      id: string;
      side: string;
      x: number;
      y: number;
    }>;
    const p1 = units.find((u) => u.id === "P-sword-1") ?? units.find((u) => u.side === "player")!;
    const e1 = units.find((u) => u.side === "enemy")!;

    const before = await pool.query("SELECT units, moves_applied FROM games WHERE id = $1", [
      gameId,
    ]);

    // illegal: archer-style out-of-range? use sword attacking far away
    const illegal = await request(app)
      .post(`/api/games/${gameId}/moves`)
      .set("Cookie", [cookie])
      .send({
        moves: [
          {
            unitId: p1.id,
            path: [[p1.x, p1.y]],
            action: { type: "attack", targetId: e1.id },
          },
        ],
      });
    expect(illegal.status).toBe(400);
    expect(illegal.body.error).toMatch(/^move 1: /);
    expect(illegal.body.error).toContain("cannot attack a unit at");

    const afterFail = await pool.query("SELECT units, moves_applied FROM games WHERE id = $1", [
      gameId,
    ]);
    expect(afterFail.rows[0].moves_applied).toBe(false);
    expect(afterFail.rows[0].units).toEqual(before.rows[0].units);

    // failed attempt leaves round unlocked - valid empty submission allowed
    const ok = await request(app)
      .post(`/api/games/${gameId}/moves`)
      .set("Cookie", [cookie])
      .send({ moves: [] });
    expect(ok.status).toBe(200);

    // second applied submission in same round -> 409
    const second = await request(app)
      .post(`/api/games/${gameId}/moves`)
      .set("Cookie", [cookie])
      .send({ moves: [] });
    expect(second.status).toBe(409);
    expect(second.body).toEqual({ error: "Turn moves already submitted" });
  });

  it("moves_applied lock is restart-proof (persisted in DB)", async () => {
    const app = makeApp();
    const cookie = await registerAndLogin(app, "lock");
    const created = await request(app)
      .post("/api/games")
      .set("Cookie", [cookie])
      .send({ difficulty: "aggressive" });
    const gameId = created.body.game.id;
    await waitForStatus(app, cookie, gameId, "player_turn");

    await request(app)
      .post(`/api/games/${gameId}/moves`)
      .set("Cookie", [cookie])
      .send({ moves: [] });
    const db = await pool.query("SELECT moves_applied FROM games WHERE id = $1", [gameId]);
    expect(db.rows[0].moves_applied).toBe(true);

    // "restart" simulation: new app instance / fresh read still enforces lock
    const app2 = makeApp();
    const again = await request(app2)
      .post(`/api/games/${gameId}/moves`)
      .set("Cookie", [cookie])
      .send({ moves: [] });
    expect(again.status).toBe(409);
    expect(again.body).toEqual({ error: "Turn moves already submitted" });
  });

  it("preview endpoint returns move/attack/heal tiles and side; enemy inspect allowed; acted own unit 404", async () => {
    const app = makeApp();
    const cookie = await registerAndLogin(app, "prev");
    const created = await request(app)
      .post("/api/games")
      .set("Cookie", [cookie])
      .send({ difficulty: "aggressive" });
    const ready = await waitForStatus(app, cookie, created.body.game.id, "player_turn");
    const gameId = created.body.game.id;
    const units = ready.body.game.units as Array<{ id: string; side: string; acted: boolean }>;
    const player = units.find((u) => u.side === "player" && !u.acted)!;
    const enemy = units.find((u) => u.side === "enemy")!;

    const own = await request(app)
      .get(`/api/games/${gameId}/preview/${player.id}`)
      .set("Cookie", [cookie]);
    expect(own.status).toBe(200);
    expect(own.body.side).toBe("player");
    expect(Array.isArray(own.body.moveTiles)).toBe(true);
    expect(Array.isArray(own.body.attackTiles)).toBe(true);
    expect(Array.isArray(own.body.healTiles)).toBe(true);

    const enemyPreview = await request(app)
      .get(`/api/games/${gameId}/preview/${enemy.id}`)
      .set("Cookie", [cookie]);
    expect(enemyPreview.status).toBe(200);
    expect(enemyPreview.body.side).toBe("enemy");

    // mark unit acted and verify 404
    await pool.query(
      `UPDATE games SET units = (
         SELECT jsonb_agg(CASE WHEN elem->>'id' = $2 THEN jsonb_set(elem, '{acted}', 'true'::jsonb) ELSE elem END)
         FROM jsonb_array_elements(units) elem
       ) WHERE id = $1`,
      [gameId, player.id],
    );
    const acted = await request(app)
      .get(`/api/games/${gameId}/preview/${player.id}`)
      .set("Cookie", [cookie]);
    expect(acted.status).toBe(404);
    expect(acted.body).toEqual({ error: "Unit not playable" });
  });

  it("forfeit works from active states and rejects finished games; conditional persist discards AI result if forfeited during ai_turn", async () => {
    const app = makeApp();
    const cookie = await registerAndLogin(app, "ff");
    const created = await request(app)
      .post("/api/games")
      .set("Cookie", [cookie])
      .send({ difficulty: "aggressive" });
    const gameId = created.body.game.id;

    // forfeit while generating_board (active)
    const ffGen = await request(app)
      .post(`/api/games/${gameId}/forfeit`)
      .set("Cookie", [cookie])
      .send();
    expect(ffGen.status).toBe(200);
    expect(ffGen.body.game.status).toBe("lost");

    const ffAgain = await request(app)
      .post(`/api/games/${gameId}/forfeit`)
      .set("Cookie", [cookie])
      .send();
    expect(ffAgain.status).toBe(409);
    expect(ffAgain.body).toEqual({ error: "Game already finished" });

    // conditional persist: forfeit makes lost stand; AI job result must be discarded
    const created2 = await request(app)
      .post("/api/games")
      .set("Cookie", [cookie])
      .send({ difficulty: "aggressive" });
    const gid2 = created2.body.game.id;
    await waitForStatus(app, cookie, gid2, "player_turn");
    await request(app).post(`/api/games/${gid2}/moves`).set("Cookie", [cookie]).send({ moves: [] });
    await request(app).post(`/api/games/${gid2}/end-turn`).set("Cookie", [cookie]).send();
    // force state to ai_turn (idempotent if job already ran fast) and forfeit, then run AI job - conditional persist must discard
    await pool.query("UPDATE games SET status = 'ai_turn', updated_at = now() WHERE id = $1", [
      gid2,
    ]);
    const ffActive = await request(app)
      .post(`/api/games/${gid2}/forfeit`)
      .set("Cookie", [cookie])
      .send();
    expect(ffActive.status).toBe(200);
    expect(ffActive.body.game.status).toBe("lost");
    const { runAiTurn } = await import("../ai/aiTurn.js");
    await runAiTurn(pool, config, gid2);
    const final = await request(app).get(`/api/games/${gid2}`).set("Cookie", [cookie]);
    expect(final.body.game.status).toBe("lost");
  });

  it("GET /api/games list includes summaries in creation order and has previewBoard/previewUnits; GET by id 404 for non-owner", async () => {
    const app = makeApp();
    const cookieA = await registerAndLogin(app, "lista");
    const cookieB = await registerAndLogin(app, "listb");

    const g1 = await request(app)
      .post("/api/games")
      .set("Cookie", [cookieA])
      .send({ difficulty: "aggressive" });
    const g2 = await request(app)
      .post("/api/games")
      .set("Cookie", [cookieA])
      .send({ difficulty: "defensive" });
    expect(g1.status).toBe(202);
    expect(g2.status).toBe(202);

    const list = await request(app).get("/api/games").set("Cookie", [cookieA]);
    expect(list.status).toBe(200);
    expect(list.body.games.map((g: { id: string }) => g.id)).toEqual([
      g1.body.game.id,
      g2.body.game.id,
    ]);
    expect(list.body.games[0]).toHaveProperty("previewBoard");
    expect(list.body.games[0]).toHaveProperty("previewUnits");
    expect(list.body.games[0].previewBoard.tiles).toHaveLength(config.boardSize);

    const forbidden = await request(app)
      .get(`/api/games/${g1.body.game.id}`)
      .set("Cookie", [cookieB]);
    expect(forbidden.status).toBe(404);
    expect(forbidden.body).toEqual({ error: "Not found" });
  });

  it("stats endpoint matches seeded outcomes and returns stable byDifficulty rows", async () => {
    const app = makeApp();
    const cookie = await registerAndLogin(app, "stats");
    // seed finished games directly
    const userRes = await pool.query("SELECT id FROM users LIMIT 1");
    const userId = userRes.rows[0].id;
    await pool.query(
      `INSERT INTO games (user_id, difficulty, status, board, units)
       VALUES ($1, 'aggressive', 'won', '{"tiles":[]}', '[]'),
              ($1, 'aggressive', 'lost', '{"tiles":[]}', '[]'),
              ($1, 'defensive', 'won', '{"tiles":[]}', '[]'),
              ($1, 'erratic', 'player_turn', '{"tiles":[]}', '[]')`,
      [userId],
    );

    const res = await request(app).get("/api/stats").set("Cookie", [cookie]);
    expect(res.status).toBe(200);
    expect(res.body.gamesPlayed).toBe(3);
    expect(res.body.wins).toBe(2);
    expect(res.body.losses).toBe(1);
    expect(res.body.winRate).toBeCloseTo(2 / 3);
    expect(res.body.byDifficulty).toHaveLength(Object.keys(config.personalities).length);
    for (const key of Object.keys(config.personalities)) {
      expect(
        res.body.byDifficulty.find((d: { difficulty: string }) => d.difficulty === key),
      ).toBeDefined();
    }
    const agg = res.body.byDifficulty.find(
      (d: { difficulty: string }) => d.difficulty === "aggressive",
    );
    expect(agg).toEqual({ difficulty: "aggressive", played: 2, wins: 1, losses: 1 });
  });

  it("server-side interval sweep resumes stale ai_turn job without client GET", async () => {
    const app = makeApp();
    const cookie = await registerAndLogin(app, "sweep");
    const created = await request(app)
      .post("/api/games")
      .set("Cookie", [cookie])
      .send({ difficulty: "aggressive" });
    const gameId = created.body.game.id;
    await waitForStatus(app, cookie, gameId, "player_turn");
    await request(app)
      .post(`/api/games/${gameId}/moves`)
      .set("Cookie", [cookie])
      .send({ moves: [] });
    await request(app).post(`/api/games/${gameId}/end-turn`).set("Cookie", [cookie]).send();

    // force stale ai_turn with no active job running by making updated_at old
    await pool.query(
      `UPDATE games SET updated_at = now() - ($2::int * interval '1 second') WHERE id = $1`,
      [gameId, config.ai.staleAfterSeconds + 5],
    );

    await sweepStaleJobs(pool, config, mockLlm);
    // wait for job to complete
    await waitForPlayerOrLost(app, cookie, gameId, 15000);
    const row = await pool.query("SELECT status, turn_number FROM games WHERE id = $1", [gameId]);
    expect(["player_turn", "lost"]).toContain(row.rows[0].status);
  });

  it("EVOLVING landing validation: chain-follow and swap-by-order succeed; occupied/claimed conflicts reject", async () => {
    const app = makeApp();
    const cookie = await registerAndLogin(app, "evolve");
    const created = await request(app)
      .post("/api/games")
      .set("Cookie", [cookie])
      .send({ difficulty: "aggressive" });
    const gameId = created.body.game.id;
    await waitForStatus(app, cookie, gameId, "player_turn");

    // Craft a controlled board state for deterministic evolving-chain cases
    const board = {
      tiles: Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => "plain")),
    };
    const units = [
      {
        id: "P-sword-1",
        side: "player",
        class: "sword",
        x: 1,
        y: 1,
        hp: 20,
        maxHp: 20,
        acted: false,
      },
      {
        id: "P-sword-2",
        side: "player",
        class: "sword",
        x: 1,
        y: 2,
        hp: 20,
        maxHp: 20,
        acted: false,
      },
      { id: "P-axe-1", side: "player", class: "axe", x: 2, y: 2, hp: 25, maxHp: 25, acted: false },
      {
        id: "E-sword-1",
        side: "enemy",
        class: "sword",
        x: 6,
        y: 6,
        hp: 20,
        maxHp: 20,
        acted: false,
      },
    ];
    await pool.query(
      "UPDATE games SET board = $2::jsonb, units = $3::jsonb, moves_applied = false, status = 'player_turn' WHERE id = $1",
      [gameId, JSON.stringify(board), JSON.stringify(units)],
    );

    // chain-follow / swap-by-order: unit at (1,2) moves away, unit at (1,1) moves into vacated (1,2) - legal in bundle order
    const chain = await request(app)
      .post(`/api/games/${gameId}/moves`)
      .set("Cookie", [cookie])
      .send({
        moves: [
          {
            unitId: "P-sword-2",
            path: [
              [1, 2],
              [1, 3],
            ],
            action: { type: "wait" },
          },
          {
            unitId: "P-sword-1",
            path: [
              [1, 1],
              [1, 2],
            ],
            action: { type: "wait" },
          },
        ],
      });
    expect(chain.status).toBe(200);
    const afterChain = (
      chain.body.game.units as Array<{ id: string; x: number; y: number }>
    ).reduce((m: Record<string, { id: string; x: number; y: number }>, u) => {
      m[u.id] = u;
      return m;
    }, {});
    expect(afterChain["P-sword-2"].x).toBe(1);
    expect(afterChain["P-sword-2"].y).toBe(3);
    expect(afterChain["P-sword-1"].x).toBe(1);
    expect(afterChain["P-sword-1"].y).toBe(2);

    // reset for must-fail cases
    await pool.query(
      "UPDATE games SET board = $2::jsonb, units = $3::jsonb, moves_applied = false, status = 'player_turn' WHERE id = $1",
      [gameId, JSON.stringify(board), JSON.stringify(units)],
    );

    // two entries claiming the same evolving tile -> reject
    const sameTile = await request(app)
      .post(`/api/games/${gameId}/moves`)
      .set("Cookie", [cookie])
      .send({
        moves: [
          {
            unitId: "P-sword-1",
            path: [
              [1, 1],
              [1, 0],
            ],
            action: { type: "wait" },
          },
          {
            unitId: "P-sword-2",
            path: [
              [1, 2],
              [1, 1],
              [1, 0],
            ],
            action: { type: "wait" },
          },
        ],
      });
    expect(sameTile.status).toBe(400);
    expect(sameTile.body.error).toMatch(/^move 2: /);

    // entering a still-occupied tile (no prior vacate) -> reject
    await pool.query(
      "UPDATE games SET board = $2::jsonb, units = $3::jsonb, moves_applied = false, status = 'player_turn' WHERE id = $1",
      [gameId, JSON.stringify(board), JSON.stringify(units)],
    );
    const occupied = await request(app)
      .post(`/api/games/${gameId}/moves`)
      .set("Cookie", [cookie])
      .send({
        moves: [
          {
            unitId: "P-sword-1",
            path: [
              [1, 1],
              [1, 2],
            ],
            action: { type: "wait" },
          },
        ],
      });
    expect(occupied.status).toBe(400);
    expect(occupied.body.error).toMatch(/^move 1: /);
  });

  it("contract/error bodies for key endpoints match spec", async () => {
    const app = makeApp();
    const cookie = await registerAndLogin(app, "contract");
    const created = await request(app)
      .post("/api/games")
      .set("Cookie", [cookie])
      .send({ difficulty: "aggressive" });
    const gameId = created.body.game.id;

    // preview while not player_turn -> 409
    const previewEarly = await request(app)
      .get(`/api/games/${gameId}/preview/P-sword-1`)
      .set("Cookie", [cookie]);
    if (previewEarly.status === 409) {
      expect(previewEarly.body).toEqual({ error: "Game is not waiting for your turn" });
    }

    await waitForStatus(app, cookie, gameId, "player_turn");

    // 404 ownership/not found
    const missing = await request(app)
      .get(`/api/games/00000000-0000-0000-0000-000000000000`)
      .set("Cookie", [cookie]);
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: "Not found" });

    // unknown difficulty
    const badDiff = await request(app)
      .post("/api/games")
      .set("Cookie", [cookie])
      .send({ difficulty: "nope" });
    expect(badDiff.status).toBe(400);
    expect(badDiff.body).toEqual({ error: "Unknown difficulty" });

    // end-turn / moves when not player_turn (use forfeited/lost game for deterministic state)
    await request(app)
      .post(`/api/games/${gameId}/moves`)
      .set("Cookie", [cookie])
      .send({ moves: [] });
    const ended = await request(app)
      .post(`/api/games/${gameId}/end-turn`)
      .set("Cookie", [cookie])
      .send();
    expect(ended.status).toBe(200);
    const forfeited = await request(app)
      .post(`/api/games/${gameId}/forfeit`)
      .set("Cookie", [cookie])
      .send();
    expect(forfeited.status).toBe(200);
    expect(forfeited.body.game.status).toBe("lost");
    const notTurnMoves = await request(app)
      .post(`/api/games/${gameId}/moves`)
      .set("Cookie", [cookie])
      .send({ moves: [] });
    expect(notTurnMoves.status).toBe(409);
    expect(notTurnMoves.body).toEqual({ error: "Game is not waiting for your turn" });
  });
});
