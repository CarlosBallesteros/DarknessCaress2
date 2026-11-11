// Endpoint 10 + 11 under the mock LLM (docs/06 + docs/09 phase 4): POST
// answers 202 immediately with the generating_board placeholder state, the
// background job designs the battlefield, and GET shows player_turn with the
// armies placed per docs/03's spawn scatter layout. Plus the capability
// checks: auth, difficulty, and the active-games cap where a generating_board
// game counts as active (non-lost counting).
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "../../app";
import { config } from "../../config/load";
import { migrate } from "../../db/migrate";
import { pool } from "../../db/pool";

const app = createServer();
const EMAIL_DOMAIN = "dc2-games.example";
const suffix = crypto.randomUUID().slice(0, 8);

type Res = { headers: Record<string, unknown> };

function cookieOf(res: Res): string {
  const setCookie = res.headers["set-cookie"];
  const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (typeof first !== "string") {
    throw new Error("expected a Set-Cookie header");
  }
  return first.split(";")[0];
}

async function registerUser(name: string): Promise<string> {
  const res = await request(app)
    .post("/api/auth/register")
    .send({
      email: `${name}-${suffix}@${EMAIL_DOMAIN}`,
      password: "correct-horse",
      username: `${name}_${suffix}`,
    });
  expect(res.status).toBe(201);
  return cookieOf(res);
}

// The job is fire-and-forget; the client discovers the designed board through
// normal polling (docs/06 endpoint 10) — so does the test.
async function pollUntil(
  cookie: string,
  gameId: string,
  status: string,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 5000;
  for (;;) {
    const res = await request(app).get(`/api/games/${gameId}`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    if (res.body.game.status === status) return res.body.game;
    if (Date.now() > deadline) {
      throw new Error(`game ${gameId} never reached ${status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

beforeAll(async () => {
  await migrate();
});

afterAll(async () => {
  await pool.query("DELETE FROM users WHERE email LIKE $1", [`%@${EMAIL_DOMAIN}`]);
  await pool.end();
});

describe("POST /api/games (docs/06 endpoint 10)", () => {
  it("401 Not authenticated without a session", async () => {
    const res = await request(app).post("/api/games").send({ difficulty: "aggressive" });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Not authenticated" });
  });

  it("400 Unknown difficulty for a non-persona id", async () => {
    const cookie = await registerUser("diff");
    const res = await request(app)
      .post("/api/games")
      .set("Cookie", cookie)
      .send({ difficulty: "nightmare" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Unknown difficulty" });
  });

  it("202 immediately: generating_board, placeholder board, empty units", async () => {
    const cookie = await registerUser("create");
    const res = await request(app)
      .post("/api/games")
      .set("Cookie", cookie)
      .send({ difficulty: "erratic" });
    expect(res.status).toBe(202);
    const game = res.body.game;
    expect(game.status).toBe("generating_board");
    expect(game.difficulty).toBe("erratic");
    expect(game.turnNumber).toBe(1);
    expect(game.units).toEqual([]);
    expect(game.lastAiActions).toBeNull();
    expect(typeof game.id).toBe("string");
    expect(game.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const size = config.boardSize;
    expect(game.board.tiles).toHaveLength(size);
    for (const row of game.board.tiles) {
      expect(row).toHaveLength(size);
      for (const tile of row) expect(tile).toBe("plain"); // the placeholder grid
    }
  });

  it("mock-LLM full flow: the background job designs the board and places both armies", async () => {
    const cookie = await registerUser("flow");
    const created = await request(app)
      .post("/api/games")
      .set("Cookie", cookie)
      .send({ difficulty: "defensive" });
    expect(created.status).toBe(202);
    const gameId = created.body.game.id as string;

    const game = await pollUntil(cookie, gameId, "player_turn");
    const size = config.boardSize;
    const tiles = (game.board as { tiles: string[][] }).tiles;
    // The real battlefield: only legal tile codes, reserved rows still plain.
    const legal = new Set(["plain", "forest", "hill", "lake", "rock", "river", "bridge"]);
    for (const row of tiles) {
      for (const tile of row) expect(legal.has(tile)).toBe(true);
    }
    for (const y of [0, 1, size - 2, size - 1]) {
      for (const tile of tiles[y]) expect(tile).toBe("plain");
    }

    // Armies per docs/03: 10 per side, 8x2 block (columns 4-11), front row =
    // 2 swords + 2 axes + 1 spear, back row = spear + 2 archers + mage +
    // healer, healer NEVER front, freshly spawned.
    const units = game.units as Array<{
      id: string;
      side: string;
      class: string;
      x: number;
      y: number;
      hp: number;
      maxHp: number;
      acted: boolean;
    }>;
    expect(units).toHaveLength(20);
    for (const side of ["player", "enemy"] as const) {
      const sideUnits = units.filter((unit) => unit.side === side);
      expect(sideUnits).toHaveLength(10);
      const frontRow = side === "player" ? size - 2 : 1;
      const backRow = side === "player" ? size - 1 : 0;
      const front = sideUnits.filter((unit) => unit.y === frontRow);
      const back = sideUnits.filter((unit) => unit.y === backRow);
      expect(
        front
          .map((u) => u.class)
          .sort()
          .join(),
      ).toBe("axe,axe,spear,sword,sword");
      expect(
        back
          .map((u) => u.class)
          .sort()
          .join(),
      ).toBe("archer,archer,healer,mage,spear");
      for (const unit of sideUnits) {
        expect(unit.x).toBeGreaterThanOrEqual(4);
        expect(unit.x).toBeLessThanOrEqual(11);
        expect(unit.id).toMatch(new RegExp(`^${side === "player" ? "P" : "E"}-`));
        expect(unit.hp).toBe(unit.maxHp);
        expect(unit.acted).toBe(false);
      }
    }
  });

  it("409 Active game limit reached (N) on the (N+1)th non-lost game — generating_board counts", async () => {
    const cookie = await registerUser("cap");
    for (let i = 0; i < config.maxActiveGames; i++) {
      const res = await request(app)
        .post("/api/games")
        .set("Cookie", cookie)
        .send({ difficulty: "aggressive" });
      expect(res.status).toBe(202);
    }
    const res = await request(app)
      .post("/api/games")
      .set("Cookie", cookie)
      .send({ difficulty: "aggressive" });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: `Active game limit reached (${config.maxActiveGames})`,
    });
  });
});

describe("GET /api/games/:id (docs/06 endpoint 11)", () => {
  it("404 Not found for an unknown game", async () => {
    const cookie = await registerUser("unknown");
    const res = await request(app).get(`/api/games/${crypto.randomUUID()}`).set("Cookie", cookie);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Not found" });
  });

  it("404 Not found for another user's game (existence never leaked)", async () => {
    const owner = await registerUser("owner");
    const stranger = await registerUser("stranger");
    const created = await request(app)
      .post("/api/games")
      .set("Cookie", owner)
      .send({ difficulty: "aggressive" });
    const res = await request(app)
      .get(`/api/games/${created.body.game.id}`)
      .set("Cookie", stranger);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Not found" });
  });

  it("404 Not found for a non-uuid id (never a 500)", async () => {
    const cookie = await registerUser("badid");
    const res = await request(app).get("/api/games/not-a-uuid").set("Cookie", cookie);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Not found" });
  });

  it("401 without a session", async () => {
    const res = await request(app).get(`/api/games/${crypto.randomUUID()}`);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Not authenticated" });
  });
});
