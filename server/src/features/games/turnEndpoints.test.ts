// Endpoints 9 and 12–15 under the mock LLM (docs/06 + docs/09 phase 5): the
// preview, the atomic once-per-round moves submission with its persisted
// restart-proof lock, end-turn firing the AI job, forfeit, and the games
// list with its stale-recovery side effect. Includes the EVOLVING landing
// validation through the API (chain-follow, exclusive claims, swap-by-order)
// and the docs/06 table walk.
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "../../app";
import { engineConfig } from "../../config/engine";
import { migrate } from "../../db/migrate";
import { pool } from "../../db/pool";
import type { Board, ClassKey, Side, Tile, Unit } from "../../game/types";
import { insertGeneratingGame } from "./repo";
import { sweepStaleJobsAllUsers } from "./jobs";

const app = createServer();
const EMAIL_DOMAIN = "dc2-turn.example";
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

interface Session {
  cookie: string;
  userId: string;
}

async function registerUser(name: string): Promise<Session> {
  const res = await request(app)
    .post("/api/auth/register")
    .send({
      email: `${name}-${suffix}@${EMAIL_DOMAIN}`,
      password: "correct-horse",
      username: `${name}_${suffix}`,
    });
  expect(res.status).toBe(201);
  return { cookie: cookieOf(res), userId: res.body.user.id as string };
}

function plainBoard(): Board {
  const size = engineConfig.boardSize;
  return { tiles: Array.from({ length: size }, () => Array<Tile>(size).fill("plain")) };
}

function unit(id: string, cls: ClassKey, side: Side, x: number, y: number, hp?: number): Unit {
  const maxHp = engineConfig.classes[cls].hp;
  return { id, side, class: cls, x, y, hp: hp ?? maxHp, maxHp, acted: false };
}

type UnitSpec = [id: string, cls: ClassKey, side: Side, x: number, y: number, hp?: number];

function buildUnits(specs: UnitSpec[]): Unit[] {
  return specs.map((spec) => unit(...spec));
}

// A player_turn game with a fully controlled all-plain board and armies,
// owned by the given (API-registered) user.
async function insertPlayerTurnGame(userId: string, specs: UnitSpec[]): Promise<string> {
  const game = await insertGeneratingGame({
    id: crypto.randomUUID(),
    userId,
    difficulty: "aggressive",
  });
  await pool.query(
    "UPDATE games SET status = 'player_turn', board = $2, units = $3 WHERE id = $1",
    [game.id, JSON.stringify(plainBoard()), JSON.stringify(buildUnits(specs))],
  );
  return game.id;
}

interface GameRowLite {
  status: string;
  units: Unit[];
  turn_number: number;
  moves_applied: boolean;
  last_ai_actions: unknown;
}

async function rawRow(gameId: string): Promise<GameRowLite> {
  const { rows } = await pool.query<GameRowLite>(
    "SELECT status, units, turn_number, moves_applied, last_ai_actions FROM games WHERE id = $1",
    [gameId],
  );
  return rows[0];
}

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
    if (Date.now() > deadline) throw new Error(`game ${gameId} never reached ${status}`);
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

describe("GET /api/games (docs/06 endpoint 9)", () => {
  it("401 Not authenticated without a session", async () => {
    const res = await request(app).get("/api/games");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Not authenticated" });
  });

  it("200 {games} in creation order with previewBoard + previewUnits shapes", async () => {
    const { cookie, userId } = await registerUser("list");
    const first = await insertPlayerTurnGame(userId, [["P-sword-1", "sword", "player", 4, 6]]);
    const second = await insertPlayerTurnGame(userId, [["P-sword-1", "sword", "player", 4, 6]]);
    const third = await insertPlayerTurnGame(userId, [["P-sword-1", "sword", "player", 4, 6]]);
    // Creation order is created_at ascending; force distinct timestamps.
    await pool.query("UPDATE games SET created_at = now() - interval '3 minutes' WHERE id = $1", [
      first,
    ]);
    await pool.query("UPDATE games SET created_at = now() - interval '2 minutes' WHERE id = $1", [
      second,
    ]);
    await pool.query("UPDATE games SET created_at = now() - interval '1 minute' WHERE id = $1", [
      third,
    ]);

    const stranger = await registerUser("nobody");
    const foreign = await request(app).get("/api/games").set("Cookie", stranger.cookie);
    expect(foreign.status).toBe(200);
    expect(foreign.body.games).toEqual([]); // a different user sees none of them

    const listed = await request(app).get("/api/games").set("Cookie", cookie);
    expect(listed.status).toBe(200);
    const games = listed.body.games;
    expect(games.map((g: { id: string }) => g.id)).toEqual([first, second, third]);
    for (const game of games) {
      expect(game.status).toBe("player_turn");
      expect(game.turnNumber).toBe(1);
      expect(typeof game.updatedAt).toBe("string");
      expect(game.previewBoard.tiles).toHaveLength(engineConfig.boardSize);
      expect(game.previewUnits).toEqual([{ x: 4, y: 6, side: "player" }]);
    }
  });

  it("side effect: a stale ai_turn row is re-triggered by the list read", async () => {
    const { cookie, userId } = await registerUser("stale");
    const gameId = await insertPlayerTurnGame(userId, [
      ["E-sword-1", "sword", "enemy", 5, 1],
      ["P-sword-1", "sword", "player", 4, 6],
    ]);
    await pool.query(
      "UPDATE games SET status = 'ai_turn', updated_at = now() - interval '5 minutes' WHERE id = $1",
      [gameId],
    );
    await request(app).get("/api/games").set("Cookie", cookie).expect(200);
    const game = await pollUntil(cookie, gameId, "player_turn");
    expect(game.turnNumber).toBe(2);
    expect(Array.isArray(game.lastAiActions)).toBe(true);
    expect((game.lastAiActions as unknown[]).length).toBeGreaterThan(0);
  });

  it("server-side interval sweep: a stale ai_turn row resumes with NO client request at all (docs/01)", async () => {
    const { userId } = await registerUser("svsweep");
    const gameId = await insertPlayerTurnGame(userId, [
      ["E-sword-1", "sword", "enemy", 5, 1],
      ["P-sword-1", "sword", "player", 4, 6],
    ]);
    await pool.query(
      "UPDATE games SET status = 'ai_turn', updated_at = now() - interval '5 minutes' WHERE id = $1",
      [gameId],
    );
    // NO HTTP request anywhere — the sweep runs because the server would run
    // it on its boot-time interval (docs/01). Called directly here; the guard
    // and the mock-LLM fixtures are the production machinery.
    await sweepStaleJobsAllUsers();
    const deadline = Date.now() + 5000;
    for (;;) {
      const row = await rawRow(gameId);
      if (row.status === "player_turn") {
        expect(row.turn_number).toBe(2);
        expect(Array.isArray(row.last_ai_actions)).toBe(true);
        expect((row.last_ai_actions as unknown[]).length).toBeGreaterThan(0);
        break;
      }
      if (Date.now() > deadline)
        throw new Error(`game ${gameId} never resumed without any client request`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  });
});

describe("GET /api/games/:id/preview/:unitId (docs/06 endpoint 12)", () => {
  it("401 Not authenticated without a session", async () => {
    const res = await request(app).get(`/api/games/${crypto.randomUUID()}/preview/P-sword-1`);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Not authenticated" });
  });

  it("404 Not found for an unknown game; 404 Unit not playable for an unknown unit", async () => {
    const { cookie } = await registerUser("prevown");
    const unknown = await request(app)
      .get(`/api/games/${crypto.randomUUID()}/preview/P-sword-1`)
      .set("Cookie", cookie);
    expect(unknown.status).toBe(404);
    expect(unknown.body).toEqual({ error: "Not found" });

    const { cookie: cookie2, userId } = await registerUser("prevown2");
    const real = await insertPlayerTurnGame(userId, [["P-sword-1", "sword", "player", 4, 6]]);
    const ghost = await request(app)
      .get(`/api/games/${real}/preview/P-ghost-1`)
      .set("Cookie", cookie2);
    expect(ghost.status).toBe(404);
    expect(ghost.body).toEqual({ error: "Unit not playable" });
  });

  it("200 own-unit staging preview computed by the shared engine", async () => {
    const { cookie, userId } = await registerUser("preview");
    const gameId = await insertPlayerTurnGame(userId, [
      ["P-sword-1", "sword", "player", 4, 6],
      ["E-axe-1", "axe", "enemy", 5, 4],
    ]);
    const res = await request(app)
      .get(`/api/games/${gameId}/preview/P-sword-1`)
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    // Tiles only, no paths; the sword can step to (5,7), from where the axe
    // at distance 1 is attackable (range [1]); nothing healable.
    expect(res.body).toEqual({
      moveTiles: expect.arrayContaining([
        [4, 6],
        [5, 7],
      ]),
      attackTiles: [[6, 7]],
      healTiles: [],
      side: "player",
    });
  });

  it("200 enemy inspection preview (read-only, side: enemy)", async () => {
    const { cookie, userId } = await registerUser("inspect");
    const gameId = await insertPlayerTurnGame(userId, [
      ["P-sword-1", "sword", "player", 4, 6],
      ["E-axe-1", "axe", "enemy", 5, 4],
    ]);
    const res = await request(app)
      .get(`/api/games/${gameId}/preview/E-axe-1`)
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.side).toBe("enemy");
    expect(res.body.moveTiles).toEqual(
      expect.arrayContaining([
        [6, 6],
        [7, 7],
      ]),
    );
    expect(res.body.attackTiles).toEqual([[4, 7]]); // the sword, from (5,7) at distance 1
  });

  it("404 Unit not playable for an own unit that already acted", async () => {
    const { cookie, userId } = await registerUser("acted");
    const gameId = await insertPlayerTurnGame(userId, [["P-sword-1", "sword", "player", 4, 6]]);
    await pool.query("UPDATE games SET units = $2 WHERE id = $1", [
      gameId,
      JSON.stringify(
        buildUnits([["P-sword-1", "sword", "player", 4, 6]]).map((u) => ({ ...u, acted: true })),
      ),
    ]);
    const res = await request(app)
      .get(`/api/games/${gameId}/preview/P-sword-1`)
      .set("Cookie", cookie);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Unit not playable" });
  });

  it("409 Game is not waiting for your turn while ai_turn", async () => {
    const { cookie, userId } = await registerUser("prevbusy");
    const gameId = await insertPlayerTurnGame(userId, [["P-sword-1", "sword", "player", 4, 6]]);
    await pool.query("UPDATE games SET status = 'ai_turn' WHERE id = $1", [gameId]);
    const res = await request(app)
      .get(`/api/games/${gameId}/preview/P-sword-1`)
      .set("Cookie", cookie);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "Game is not waiting for your turn" });
  });
});

describe("POST /api/games/:id/moves (docs/06 endpoint 13)", () => {
  it("401 / 404 / 409 contract statuses", async () => {
    const res = await request(app)
      .post(`/api/games/${crypto.randomUUID()}/moves`)
      .send({ moves: [] });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Not authenticated" });

    const { cookie } = await registerUser("mvauth");
    const bad = await request(app)
      .post(`/api/games/${crypto.randomUUID()}/moves`)
      .set("Cookie", cookie)
      .send({ moves: [] });
    expect(bad.status).toBe(404);
    expect(bad.body).toEqual({ error: "Not found" });

    const { cookie: cookie2, userId } = await registerUser("mvbusy");
    const gameId = await insertPlayerTurnGame(userId, [["P-sword-1", "sword", "player", 4, 6]]);
    await pool.query("UPDATE games SET status = 'ai_turn' WHERE id = $1", [gameId]);
    const busy = await request(app)
      .post(`/api/games/${gameId}/moves`)
      .set("Cookie", cookie2)
      .send({ moves: [] });
    expect(busy.status).toBe(409);
    expect(busy.body).toEqual({ error: "Game is not waiting for your turn" });
  });

  it("zod shape failure → 400 with the first zod issue (generic body)", async () => {
    const { cookie, userId } = await registerUser("mvzod");
    const gameId = await insertPlayerTurnGame(userId, [
      ["P-sword-1", "sword", "player", 4, 6],
      ["E-axe-1", "axe", "enemy", 5, 3],
    ]);
    const res = await request(app)
      .post(`/api/games/${gameId}/moves`)
      .set("Cookie", cookie)
      .send({});
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
  });

  it("applies a valid bundle: units acted, 200, one-per-round lock engaged", async () => {
    const { cookie, userId } = await registerUser("mvok");
    const gameId = await insertPlayerTurnGame(userId, [
      ["P-sword-1", "sword", "player", 4, 6],
      ["P-spear-1", "spear", "player", 6, 6],
      ["E-axe-1", "axe", "enemy", 5, 3], // alive, so the victory check stays quiet
    ]);
    const res = await request(app)
      .post(`/api/games/${gameId}/moves`)
      .set("Cookie", cookie)
      .send({
        moves: [
          {
            unitId: "P-sword-1",
            path: [
              [4, 6],
              [4, 6],
            ],
            action: { type: "wait" },
          },
          {
            unitId: "P-spear-1",
            path: [
              [6, 6],
              [6, 6],
            ],
            action: { type: "wait" },
          },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.game.status).toBe("player_turn");
    const units = res.body.game.units;
    expect(units.find((u: Unit) => u.id === "P-sword-1")).toMatchObject({
      x: 4,
      y: 6,
      acted: true,
    });
    expect(units.find((u: Unit) => u.id === "P-spear-1")).toMatchObject({
      x: 6,
      y: 6,
      acted: true,
    });
    expect((await rawRow(gameId)).moves_applied).toBe(true);

    const again = await request(app)
      .post(`/api/games/${gameId}/moves`)
      .set("Cookie", cookie)
      .send({ moves: [{ unitId: "P-sword-1", path: [[4, 6]], action: { type: "wait" } }] });
    expect(again.status).toBe(409);
    expect(again.body).toEqual({ error: "Turn moves already submitted" });
  });

  it("the lock is RESTART-PROOF: a fresh server instance still refuses", async () => {
    const { cookie, userId } = await registerUser("restart");
    const gameId = await insertPlayerTurnGame(userId, [
      ["P-sword-1", "sword", "player", 4, 6],
      ["E-axe-1", "axe", "enemy", 5, 3],
    ]);
    const applied = await request(app)
      .post(`/api/games/${gameId}/moves`)
      .set("Cookie", cookie)
      .send({ moves: [] }); // an empty bundle consumes the budget
    expect(applied.status).toBe(200);

    // A server restart mid-round: a brand-new app over the same database.
    const freshApp = createServer();
    const res = await request(freshApp)
      .post(`/api/games/${gameId}/moves`)
      .set("Cookie", cookie)
      .send({ moves: [{ unitId: "P-sword-1", path: [[4, 6]], action: { type: "wait" } }] });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "Turn moves already submitted" });
  });

  it("an empty bundle applies nothing but consumes the round; end-turn still works", async () => {
    const { cookie, userId } = await registerUser("empty");
    const gameId = await insertPlayerTurnGame(userId, [
      ["P-sword-1", "sword", "player", 4, 6],
      ["E-axe-1", "axe", "enemy", 5, 3],
    ]);
    const res = await request(app)
      .post(`/api/games/${gameId}/moves`)
      .set("Cookie", cookie)
      .send({ moves: [] });
    expect(res.status).toBe(200);
    const row = await rawRow(gameId);
    expect(row.moves_applied).toBe(true);
    expect(row.units.every((u) => !u.acted)).toBe(true); // applies nothing

    const locked = await request(app)
      .post(`/api/games/${gameId}/moves`)
      .set("Cookie", cookie)
      .send({ moves: [] });
    expect(locked.status).toBe(409);

    const end = await request(app).post(`/api/games/${gameId}/end-turn`).set("Cookie", cookie);
    expect(end.status).toBe(200); // the lock resets with the acted stroke
  });

  it("400 with the exact engine message under the 'move N:' prefix; the row is untouched; re-submission allowed", async () => {
    const { cookie, userId } = await registerUser("mvbad");
    const gameId = await insertPlayerTurnGame(userId, [
      ["P-sword-1", "sword", "player", 4, 6],
      ["P-spear-1", "spear", "player", 6, 6],
    ]);
    const before = await rawRow(gameId);

    const res = await request(app)
      .post(`/api/games/${gameId}/moves`)
      .set("Cookie", cookie)
      .send({
        moves: [
          { unitId: "P-sword-1", path: [[4, 6]], action: { type: "wait" } },
          // 7 entries = 6 edges; the spear's mov is 5 (docs/02 catalogue).
          {
            unitId: "P-spear-1",
            path: [
              [6, 6],
              [6, 6],
              [6, 5],
              [6, 4],
              [6, 3],
              [6, 2],
              [6, 1],
            ],
            action: { type: "wait" },
          },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "move 2: path length 6 exceeds movement 5" });

    const after = await rawRow(gameId);
    expect(after).toEqual(before); // atomicity: nothing was written

    const fixed = await request(app)
      .post(`/api/games/${gameId}/moves`)
      .set("Cookie", cookie)
      .send({
        moves: [
          { unitId: "P-sword-1", path: [[4, 6]], action: { type: "wait" } },
          {
            unitId: "P-spear-1",
            path: [
              [6, 6],
              [6, 6],
            ],
            action: { type: "wait" },
          },
        ],
      });
    expect(fixed.status).toBe(200); // FAILED attempts leave the round unlocked
  });

  it("move 1 errors carry index 1 (unknown unit)", async () => {
    const { cookie, userId } = await registerUser("mvu1");
    const gameId = await insertPlayerTurnGame(userId, [["P-sword-1", "sword", "player", 4, 6]]);
    const res = await request(app)
      .post(`/api/games/${gameId}/moves`)
      .set("Cookie", cookie)
      .send({ moves: [{ unitId: "P-ghost-1", path: [[4, 6]], action: { type: "wait" } }] });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "move 1: unknown unit P-ghost-1" });
  });

  it("two entries claiming ONE evolving tile → move 1 (the earlier entry)", async () => {
    const { cookie, userId } = await registerUser("claim");
    const gameId = await insertPlayerTurnGame(userId, [
      ["P-sword-1", "sword", "player", 4, 6],
      ["P-spear-1", "spear", "player", 6, 6],
    ]);
    const res = await request(app)
      .post(`/api/games/${gameId}/moves`)
      .set("Cookie", cookie)
      .send({
        moves: [
          {
            unitId: "P-sword-1",
            path: [
              [4, 6],
              [5, 7],
            ],
            action: { type: "wait" },
          },
          {
            unitId: "P-spear-1",
            path: [
              [6, 6],
              [5, 7],
            ],
            action: { type: "wait" },
          },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "move 1: tile (5,7) is claimed by two moves" });
  });

  it("entering a still-occupied tile → move 2 (occupied in the turn chain)", async () => {
    const { cookie, userId } = await registerUser("occ");
    const gameId = await insertPlayerTurnGame(userId, [
      ["P-sword-1", "sword", "player", 4, 6],
      ["P-spear-1", "spear", "player", 6, 6],
      // A third unit receives NO entry this round — its tile stays occupied
      // in the evolving state through the whole bundle.
      ["P-axe-1", "axe", "player", 5, 6],
    ]);
    const res = await request(app)
      .post(`/api/games/${gameId}/moves`)
      .set("Cookie", cookie)
      .send({
        moves: [
          { unitId: "P-sword-1", path: [[4, 6]], action: { type: "wait" } },
          {
            unitId: "P-spear-1",
            path: [
              [6, 6],
              [5, 7],
            ],
            action: { type: "wait" },
          },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: "move 2: tile (5,7) is occupied in the current position of the turn chain",
    });
  });

  it("EVOLVING chain-follow: a later entry lands on a tile an earlier entry vacated", async () => {
    const { cookie, userId } = await registerUser("chain");
    const gameId = await insertPlayerTurnGame(userId, [
      ["P-sword-1", "sword", "player", 4, 6],
      ["P-spear-1", "spear", "player", 6, 6],
      ["E-axe-1", "axe", "enemy", 5, 3],
    ]);
    const res = await request(app)
      .post(`/api/games/${gameId}/moves`)
      .set("Cookie", cookie)
      .send({
        moves: [
          {
            unitId: "P-sword-1",
            path: [
              [4, 6],
              [4, 6],
            ],
            action: { type: "wait" },
          },
          {
            unitId: "P-spear-1",
            path: [
              [6, 6],
              [5, 7],
              [4, 6],
            ],
            action: { type: "wait" },
          },
        ],
      });
    expect(res.status).toBe(200);
    const units = res.body.game.units;
    expect(units.find((u: Unit) => u.id === "P-sword-1")).toMatchObject({ x: 4, y: 6 });
    expect(units.find((u: Unit) => u.id === "P-spear-1")).toMatchObject({ x: 4, y: 7 });
  });

  it("EVOLVING swap-by-order works (B first, then A into B's vacated origin)", async () => {
    const { cookie, userId } = await registerUser("swap");
    const gameId = await insertPlayerTurnGame(userId, [
      ["P-sword-1", "sword", "player", 4, 6],
      ["P-spear-1", "spear", "player", 6, 6],
      ["E-axe-1", "axe", "enemy", 5, 3],
    ]);
    const ordered = await request(app)
      .post(`/api/games/${gameId}/moves`)
      .set("Cookie", cookie)
      .send({
        moves: [
          {
            unitId: "P-spear-1",
            path: [
              [6, 6],
              [6, 6],
              [5, 6],
            ],
            action: { type: "wait" },
          },
          {
            unitId: "P-sword-1",
            path: [
              [4, 6],
              [5, 7],
              [6, 6],
            ],
            action: { type: "wait" },
          },
        ],
      });
    expect(ordered.status).toBe(200);
    const units = ordered.body.game.units;
    expect(units.find((u: Unit) => u.id === "P-spear-1")).toMatchObject({ x: 5, y: 6 });
    expect(units.find((u: Unit) => u.id === "P-sword-1")).toMatchObject({ x: 6, y: 7 });
  });

  it("EVOLVING dirty swap (A into B's tile while B is still there) is impossible", async () => {
    const { cookie, userId } = await registerUser("dswap");
    const gameId = await insertPlayerTurnGame(userId, [
      ["P-sword-1", "sword", "player", 4, 6],
      ["P-spear-1", "spear", "player", 6, 6],
    ]);
    const res = await request(app)
      .post(`/api/games/${gameId}/moves`)
      .set("Cookie", cookie)
      .send({
        moves: [
          {
            unitId: "P-sword-1",
            path: [
              [4, 6],
              [5, 7],
              [6, 6],
            ],
            action: { type: "wait" },
          },
          {
            unitId: "P-spear-1",
            path: [
              [6, 6],
              [5, 7],
              [4, 6],
            ],
            action: { type: "wait" },
          },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: "move 1: tile (6,7) is occupied in the current position of the turn chain",
    });
  });

  it("victory short-circuit: wiping the last enemy → won; no end-turn, no forfeit", async () => {
    const { cookie, userId } = await registerUser("won");
    const gameId = await insertPlayerTurnGame(userId, [
      ["P-sword-1", "sword", "player", 4, 6],
      ["E-archer-1", "archer", "enemy", 5, 6, 1],
    ]);
    const res = await request(app)
      .post(`/api/games/${gameId}/moves`)
      .set("Cookie", cookie)
      .send({
        moves: [
          {
            unitId: "P-sword-1",
            path: [[4, 6]],
            action: { type: "attack", targetId: "E-archer-1" },
          },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.game.status).toBe("won");

    const end = await request(app).post(`/api/games/${gameId}/end-turn`).set("Cookie", cookie);
    expect(end.status).toBe(409);
    expect(end.body).toEqual({ error: "Game is not waiting for your turn" });

    const forfeit = await request(app).post(`/api/games/${gameId}/forfeit`).set("Cookie", cookie);
    expect(forfeit.status).toBe(409);
    expect(forfeit.body).toEqual({ error: "Game already finished" });
  });
});

describe("POST /api/games/:id/end-turn (docs/06 endpoint 14)", () => {
  it("401 / 404 contract statuses", async () => {
    const res = await request(app).post(`/api/games/${crypto.randomUUID()}/end-turn`);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Not authenticated" });

    const { cookie } = await registerUser("etauth");
    const bad = await request(app)
      .post(`/api/games/${crypto.randomUUID()}/end-turn`)
      .set("Cookie", cookie);
    expect(bad.status).toBe(404);
    expect(bad.body).toEqual({ error: "Not found" });
  });

  it("flips to ai_turn, resets BOTH sides' acted flags and the round lock, then the job resolves", async () => {
    const { cookie, userId } = await registerUser("endturn");
    const gameId = await insertPlayerTurnGame(userId, [
      ["E-sword-1", "sword", "enemy", 5, 1],
      ["P-sword-1", "sword", "player", 4, 6],
    ]);

    // A prior submission marked the player's unit acted; the round was locked.
    await request(app)
      .post(`/api/games/${gameId}/moves`)
      .set("Cookie", cookie)
      .send({ moves: [{ unitId: "P-sword-1", path: [[4, 6]], action: { type: "wait" } }] })
      .expect(200);

    const res = await request(app).post(`/api/games/${gameId}/end-turn`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.game.status).toBe("ai_turn");
    expect(res.body.game.turnNumber).toBe(1); // unchanged here
    expect(res.body.game.units.every((u: Unit) => !u.acted)).toBe(true); // both sides reset
    expect((await rawRow(gameId)).moves_applied).toBe(false);

    // The fire-and-forget job applies the enemy's turn via server-side policy
    // (docs/04): aggressive advances toward the player.
    const game = await pollUntil(cookie, gameId, "player_turn");
    expect(game.turnNumber).toBe(2);
    const actions = game.lastAiActions as Array<{
      unitId: string;
      path: [number, number][];
      action: { type: string };
    }>;
    expect(actions).toHaveLength(1);
    expect(actions[0].unitId).toBe("E-sword-1");
    expect(actions[0].path[0]).toEqual([5, 1]); // started at its tile
    expect(actions[0].path.length).toBeGreaterThanOrEqual(1);
    expect(actions[0].action.type).toBe("wait");
    const eSword = (game.units as Unit[]).find((u) => u.id === "E-sword-1")!;
    expect(eSword.acted).toBe(true);
    expect(eSword.y).toBeGreaterThan(1); // advanced south toward the player
    expect((game.units as Unit[]).find((u) => u.id === "P-sword-1")?.acted).toBe(false);

    // A second end-turn while the game is (deterministically) back in
    // ai_turn is the contracted 409.
    await pool.query("UPDATE games SET status = 'ai_turn' WHERE id = $1", [gameId]);
    const again = await request(app).post(`/api/games/${gameId}/end-turn`).set("Cookie", cookie);
    expect(again.status).toBe(409);
    expect(again.body).toEqual({ error: "Game is not waiting for your turn" });
  });

  it("a forfeit during the AI's thinking stands (the job's result is discarded)", async () => {
    const { cookie, userId } = await registerUser("race");
    const gameId = await insertPlayerTurnGame(userId, [
      ["E-sword-1", "sword", "enemy", 5, 1],
      ["P-sword-1", "sword", "player", 4, 6],
    ]);
    await request(app).post(`/api/games/${gameId}/end-turn`).set("Cookie", cookie).expect(200);
    const forfeit = await request(app).post(`/api/games/${gameId}/forfeit`).set("Cookie", cookie);
    expect(forfeit.status).toBe(200);
    expect(forfeit.body.game.status).toBe("lost");

    // Whatever the racing job does, lost is terminal.
    await new Promise((resolve) => setTimeout(resolve, 200));
    const final = await request(app).get(`/api/games/${gameId}`).set("Cookie", cookie);
    expect(final.body.game.status).toBe("lost");
  });
});

describe("POST /api/games/:id/forfeit (docs/06 endpoint 15)", () => {
  it("401 / 404 contract statuses", async () => {
    const res = await request(app).post(`/api/games/${crypto.randomUUID()}/forfeit`);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Not authenticated" });

    const { cookie } = await registerUser("ffauth");
    const bad = await request(app)
      .post(`/api/games/${crypto.randomUUID()}/forfeit`)
      .set("Cookie", cookie);
    expect(bad.status).toBe(404);
    expect(bad.body).toEqual({ error: "Not found" });
  });

  it("forfeits an active player_turn game; a repeat is rejected (no idempotent success)", async () => {
    const { cookie, userId } = await registerUser("forfeit");
    const gameId = await insertPlayerTurnGame(userId, [["P-sword-1", "sword", "player", 4, 6]]);
    const res = await request(app).post(`/api/games/${gameId}/forfeit`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.game.status).toBe("lost");
    const repeat = await request(app).post(`/api/games/${gameId}/forfeit`).set("Cookie", cookie);
    expect(repeat.status).toBe(409);
    expect(repeat.body).toEqual({ error: "Game already finished" });
  });

  it("a forever-designing game is un-stuck exactly this way (generating_board → lost)", async () => {
    const { cookie } = await registerUser("design");
    const created = await request(app)
      .post("/api/games")
      .set("Cookie", cookie)
      .send({ difficulty: "aggressive" });
    expect(created.status).toBe(202);
    const gameId = created.body.game.id as string;
    const res = await request(app).post(`/api/games/${gameId}/forfeit`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.game.status).toBe("lost");
  });
});

describe("docs/06 contract walk (the full table, one happy path each)", () => {
  it("every row of the table answers with the contracted path/status/body shape", async () => {
    const email = `walk-${suffix}@${EMAIL_DOMAIN}`;
    const health = await request(app).get("/api/health");
    expect(health.status).toBe(200);
    expect(health.body).toEqual({ ok: true });

    const meta = await request(app).get("/api/meta");
    expect(meta.status).toBe(200);
    expect(meta.body).toHaveProperty("boardSize");

    const register = await request(app)
      .post("/api/auth/register")
      .send({ email, password: "correct-horse", username: `walk_${suffix}` });
    expect(register.status).toBe(201);
    expect(register.body).toHaveProperty("user");
    const cookie = cookieOf(register);

    const login = await request(app)
      .post("/api/auth/login")
      .send({ email, password: "correct-horse" });
    expect(login.status).toBe(200);
    expect(login.body).toHaveProperty("user");

    const me = await request(app).get("/api/me").set("Cookie", cookie);
    expect(me.status).toBe(200);
    expect(me.body).toHaveProperty("user");

    const patch = await request(app)
      .patch("/api/me")
      .set("Cookie", cookie)
      .send({ username: `walk2_${suffix}` });
    expect(patch.status).toBe(200);
    expect(patch.body).toHaveProperty("user");

    const password = await request(app)
      .patch("/api/me/password")
      .set("Cookie", cookie)
      .send({ currentPassword: "correct-horse", newPassword: "correct-horse-2" });
    expect(password.status).toBe(204);

    const stats = await request(app).get("/api/stats").set("Cookie", cookie);
    expect(stats.status).toBe(200);
    expect(stats.body).toHaveProperty("gamesPlayed");
    expect(stats.body).toHaveProperty("byDifficulty");

    const list = await request(app).get("/api/games").set("Cookie", cookie);
    expect(list.status).toBe(200);
    expect(list.body).toHaveProperty("games");

    const created = await request(app)
      .post("/api/games")
      .set("Cookie", cookie)
      .send({ difficulty: "aggressive" });
    expect(created.status).toBe(202);
    expect(created.body).toHaveProperty("game");
    const gameId = created.body.game.id as string;
    const game = await pollUntil(cookie, gameId, "player_turn");
    const ownUnit = (game.units as Unit[]).find((u) => u.side === "player")!;

    const shown = await request(app).get(`/api/games/${gameId}`).set("Cookie", cookie);
    expect(shown.status).toBe(200);
    expect(shown.body).toHaveProperty("game");

    const preview = await request(app)
      .get(`/api/games/${gameId}/preview/${ownUnit.id}`)
      .set("Cookie", cookie);
    expect(preview.status).toBe(200);
    expect(preview.body).toHaveProperty("moveTiles");
    expect(preview.body).toHaveProperty("attackTiles");
    expect(preview.body).toHaveProperty("healTiles");
    expect(preview.body).toHaveProperty("side");

    const moves = await request(app)
      .post(`/api/games/${gameId}/moves`)
      .set("Cookie", cookie)
      .send({
        moves: [{ unitId: ownUnit.id, path: [[ownUnit.x, ownUnit.y]], action: { type: "wait" } }],
      });
    expect(moves.status).toBe(200);
    expect(moves.body).toHaveProperty("game");

    const endTurn = await request(app).post(`/api/games/${gameId}/end-turn`).set("Cookie", cookie);
    expect(endTurn.status).toBe(200);
    expect(endTurn.body.game.status).toBe("ai_turn");

    const forfeit = await request(app).post(`/api/games/${gameId}/forfeit`).set("Cookie", cookie);
    expect(forfeit.status).toBe(200);
    expect(forfeit.body.game.status).toBe("lost");

    const logout = await request(app).post("/api/auth/logout");
    expect(logout.status).toBe(204);
  });
});
