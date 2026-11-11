// Endpoint tests for POST /api/games (docs/06 endpoint 10, docs/09 phase 4):
// mock-LLM full flow — auth + capability checks + synchronous board
// generation + army assembly per 03's spawn scatter layout + the cap 409.
// Runs against the real (loopback) database; LLM_MOCK=1 is injected by the
// vitest config, so the brief is the committed fixture.
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createApp } from "../../app";
import { pool } from "../../db/pool";
import { config } from "../../config/config";
import { engineConfig } from "../../game/engine-config";
import { makeBoard, e, p } from "../../game/fixtures";
import type { Unit } from "../../game/types";
import { validateBoard, validateSpawn } from "../board/invariants";
import { assembleArmies } from "../board/spawn";
import { getGameById, insertGame } from "./games.repo";
import type { GameStateDto } from "./games.dto";
import { queueTurnFixtures, resetTurnFixtures } from "../ai/mockLlm";

let server: Server;
let baseUrl: string;
const createdUserIds: string[] = [];

const uniqueUsername = () =>
  `u_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const uniqueEmail = () => `${randomUUID().replaceAll("-", "")}@example.com`;

function cookieOf(res: request.Response): string {
  const setCookie = res.headers["set-cookie"] as unknown as
    string[] | undefined;
  expect(setCookie, "expected a session cookie to be set").toBeDefined();
  return setCookie![0].split(";")[0];
}

async function registerUser(): Promise<request.Response> {
  const res = await request(baseUrl).post("/api/auth/register").send({
    email: uniqueEmail(),
    password: "correct-horse",
    username: uniqueUsername(),
  });
  expect(res.status).toBe(201);
  createdUserIds.push(res.body.user.id);
  return res;
}

async function createGame(
  cookie: string,
  difficulty = "aggressive",
): Promise<request.Response> {
  return request(baseUrl)
    .post("/api/games")
    .set("Cookie", cookie)
    .send({ difficulty });
}

// A crafted game bypassing generation, for turn-flow tests: the units are the
// fixture, the board is plain, and the status is set directly in the row.
async function insertCraftedGame(
  userId: string,
  units: Unit[],
  status = "player_turn",
): Promise<{ id: string }> {
  const row = await insertGame({
    id: randomUUID(),
    userId,
    difficulty: "aggressive",
    board: makeBoard(),
    units,
    usedFallback: false,
  });
  if (status !== "player_turn") {
    await pool.query("UPDATE games SET status = $2 WHERE id = $1", [
      row.id,
      status,
    ]);
  }
  return { id: row.id };
}

beforeAll(async () => {
  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

beforeEach(() => {
  resetTurnFixtures();
});

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await pool.query("DELETE FROM users WHERE id = ANY($1)", [createdUserIds]);
  }
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  await pool.end();
});

describe("POST /api/games", () => {
  it('401 {"error":"Not authenticated"} without a session', async () => {
    const res = await request(baseUrl)
      .post("/api/games")
      .send({ difficulty: "aggressive" });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Not authenticated" });
  });

  it('400 {"error":"Unknown difficulty"} for a non-config persona', async () => {
    const register = await registerUser();
    const res = await createGame(cookieOf(register), "impossible");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Unknown difficulty" });
  });

  it("creates a game: 201 GameState with armies placed per 03's spawn scatter layout", async () => {
    const register = await registerUser();
    const res = await createGame(cookieOf(register));
    expect(res.status).toBe(201);

    const game = res.body.game as GameStateDto;
    expect(Object.keys(game).sort()).toEqual(
      [
        "board",
        "difficulty",
        "id",
        "lastAiActions",
        "status",
        "turnNumber",
        "units",
        "updatedAt",
      ].sort(),
    );
    expect(game.difficulty).toBe("aggressive");
    expect(game.status).toBe("player_turn");
    expect(game.turnNumber).toBe(1);
    expect(game.lastAiActions).toBeNull();
    expect(game.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // Board: 15x15 of valid tile words, all invariants hold.
    const board = game.board;
    expect(board.tiles).toHaveLength(config.boardSize);
    for (const row of board.tiles) {
      expect(row).toHaveLength(config.boardSize);
    }
    expect(
      validateBoard(
        board,
        // the mock brief fixture, verbatim (docs/04: committed fixtures)
        {
          river: { startRow: 7, endRow: 6, bends: 2 },
          bridgeTiles: 2,
          forestZones: [
            { centerX: 5, centerY: 4, radius: 2 },
            { centerX: 9, centerY: 10, radius: 2 },
          ],
          hillZones: [{ centerX: 10, centerY: 3, radius: 1 }],
          lake: { centerX: 7, centerY: 7, radius: 1 },
        },
      ),
    ).toBeNull();

    // Armies: 10 per side, ids "<P|E>-<class>-<n>", per 03's scatter layout.
    const units = game.units;
    expect(units).toHaveLength(20);
    expect(validateSpawn(board, units, engineConfig)).toBeNull();

    for (const side of ["player", "enemy"] as const) {
      const sideUnits = units.filter((unit) => unit.side === side);
      expect(sideUnits).toHaveLength(10);
      const healer = sideUnits.find((unit) => unit.class === "healer");
      expect(healer).toBeDefined();
      // healer NEVER front: player back row 14, enemy back row 0.
      expect(healer!.y).toBe(side === "player" ? 14 : 0);
      const ids = sideUnits.map((unit) => unit.id);
      expect(ids).toEqual([
        `${side === "player" ? "P" : "E"}-sword-1`,
        `${side === "player" ? "P" : "E"}-sword-2`,
        `${side === "player" ? "P" : "E"}-axe-1`,
        `${side === "player" ? "P" : "E"}-axe-2`,
        `${side === "player" ? "P" : "E"}-spear-1`,
        `${side === "player" ? "P" : "E"}-spear-2`,
        `${side === "player" ? "P" : "E"}-archer-1`,
        `${side === "player" ? "P" : "E"}-archer-2`,
        `${side === "player" ? "P" : "E"}-mage-1`,
        `${side === "player" ? "P" : "E"}-healer-1`,
      ]);
    }
  });

  it("409 on the 6th active game (cap from config)", async () => {
    const register = await registerUser();
    const cookie = cookieOf(register);
    for (let i = 0; i < config.maxActiveGames; i++) {
      const res = await createGame(
        cookie,
        i % 2 === 0 ? "aggressive" : "defensive",
      );
      expect(res.status).toBe(201);
    }
    const res = await createGame(cookie);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: `Active game limit reached (${config.maxActiveGames})`,
    });
  });
});

describe("endpoints 9/11-15 — contract conformance (docs/06, docs/09 phase 5)", () => {
  it("401 Not authenticated on every new endpoint without a session", async () => {
    const id = randomUUID();
    for (const attempt of [
      () => request(baseUrl).get("/api/games"),
      () => request(baseUrl).get(`/api/games/${id}`),
      () => request(baseUrl).get(`/api/games/${id}/preview/P-sword-1`),
      () => request(baseUrl).post(`/api/games/${id}/moves`).send({ moves: [] }),
      () => request(baseUrl).post(`/api/games/${id}/end-turn`),
      () => request(baseUrl).post(`/api/games/${id}/forfeit`),
      () => request(baseUrl).get("/api/stats"),
    ]) {
      const res = await attempt();
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "Not authenticated" });
    }
  });

  it("404 Not found for another user's game — existence is never leaked", async () => {
    const owner = await registerUser();
    const game = await insertCraftedGame(owner.body.user.id, [
      p("P-sword-1", "sword", 5, 7),
      e("E-sword-1", "sword", 5, 5),
    ]);
    const outsider = await registerUser();
    for (const attempt of [
      () =>
        request(baseUrl)
          .get(`/api/games/${game.id}`)
          .set("Cookie", cookieOf(outsider)),
      () =>
        request(baseUrl)
          .get(`/api/games/${game.id}/preview/P-sword-1`)
          .set("Cookie", cookieOf(outsider)),
      () =>
        request(baseUrl)
          .post(`/api/games/${game.id}/moves`)
          .send({ moves: [] })
          .set("Cookie", cookieOf(outsider)),
      () =>
        request(baseUrl)
          .post(`/api/games/${game.id}/end-turn`)
          .set("Cookie", cookieOf(outsider)),
      () =>
        request(baseUrl)
          .post(`/api/games/${game.id}/forfeit`)
          .set("Cookie", cookieOf(outsider)),
    ]) {
      const res = await attempt();
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Not found" });
    }
  });

  it("endpoint 9: creation-ordered summaries with previewBoard; finished games stay in place", async () => {
    const register = await registerUser();
    const cookie = cookieOf(register);
    const userId = register.body.user.id as string;
    const first = await insertCraftedGame(userId, [
      p("P-sword-1", "sword", 5, 7),
    ]);
    const second = await insertCraftedGame(userId, [
      p("P-sword-1", "sword", 5, 7),
    ]);
    await pool.query("UPDATE games SET status = 'lost' WHERE id = $1", [
      first.id,
    ]);
    const third = await insertCraftedGame(userId, [
      p("P-sword-1", "sword", 5, 7),
    ]);
    const res = await request(baseUrl).get("/api/games").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.games.map((g: { id: string }) => g.id)).toEqual([
      first.id,
      second.id,
      third.id,
    ]);
    for (const summary of res.body.games as Array<{
      id: string;
      previewBoard: unknown;
      turnNumber: unknown;
      updatedAt: string;
    }>) {
      expect(Object.keys(summary).sort()).toEqual([
        "difficulty",
        "id",
        "previewBoard",
        "status",
        "turnNumber",
        "updatedAt",
      ]);
      expect(typeof summary.turnNumber).toBe("number");
      expect(summary.previewBoard).toHaveProperty("tiles");
      expect(new Date(summary.updatedAt).toISOString()).toBe(summary.updatedAt);
    }
  });

  it("endpoint 11: full GameState while ai_turn reflects the state at query time", async () => {
    const register = await registerUser();
    const cookie = cookieOf(register);
    const game = await insertCraftedGame(
      register.body.user.id,
      [p("P-sword-1", "sword", 5, 7), e("E-sword-1", "sword", 5, 5)],
      "ai_turn",
    );
    const res = await request(baseUrl)
      .get(`/api/games/${game.id}`)
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.game).toMatchObject({
      id: game.id,
      difficulty: "aggressive",
      status: "ai_turn",
      turnNumber: 1,
      lastAiActions: null,
    });
    expect(res.body.game.board.tiles).toHaveLength(config.boardSize);
    expect(res.body.game.units).toHaveLength(2);
  });

  it("endpoint 12: archer preview is set-membership (range [2] marks exactly 2) and carries side", async () => {
    const register = await registerUser();
    const cookie = cookieOf(register);
    // fence the archer in: (1,14) is water and the enemy at (0,13) blocks the
    // other exit — the ONLY reachable final tile is the archer's own (0,14)
    const board = makeBoard([[1, 14, "river"]]);
    const game = await insertGame({
      id: randomUUID(),
      userId: register.body.user.id,
      difficulty: "aggressive",
      board,
      units: [
        p("P-archer-1", "archer", 0, 14),
        // distance 2 from (0,14): inside the archer's range LIST
        e("E-sword-2", "sword", 1, 13),
        // distance 1: NOT attackable — a range list is membership, not ≤ max
        e("E-sword-1", "sword", 0, 13),
      ],
      usedFallback: false,
    });
    const res = await request(baseUrl)
      .get(`/api/games/${game.id}/preview/P-archer-1`)
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      moveTiles: [[0, 14]],
      attackTiles: [[1, 13]],
      healTiles: [],
      side: "player",
    });
  });

  it("endpoint 12: enemy units get a read-only inspection preview with side enemy — even after THEY acted", async () => {
    const register = await registerUser();
    const cookie = cookieOf(register);
    const game = await insertCraftedGame(register.body.user.id, [
      p("P-sword-1", "sword", 5, 7),
      e("E-archer-1", "archer", 5, 5),
      // the AI turn has already run for this one: acted is true, but the
      // 404 rule is scoped to OWN units (docs/06 ep. 12) — inspection stands
      e("E-spear-1", "spear", 9, 13, { acted: true }),
    ]);
    const archer = await request(baseUrl)
      .get(`/api/games/${game.id}/preview/E-archer-1`)
      .set("Cookie", cookie);
    expect(archer.status).toBe(200);
    expect(archer.body.side).toBe("enemy");
    // distance 2 from the archer's tile is in range, 1 is not (membership)
    expect(archer.body.attackTiles).toEqual([[5, 7]]);
    expect(archer.body.moveTiles).toContainEqual([5, 6]);

    const actedEnemy = await request(baseUrl)
      .get(`/api/games/${game.id}/preview/E-spear-1`)
      .set("Cookie", cookie);
    expect(actedEnemy.status).toBe(200);
    expect(actedEnemy.body.side).toBe("enemy");
  });

  it("endpoint 12: healer preview lists wounded adjacent allies; acted/unknown own units are Unit not playable", async () => {
    const register = await registerUser();
    const cookie = cookieOf(register);
    const game = await insertCraftedGame(register.body.user.id, [
      p("P-healer-1", "healer", 5, 7),
      p("P-sword-1", "sword", 5, 6, { hp: 9 }),
      p("P-sword-2", "sword", 4, 7), // full hp — not healable
      e("E-sword-1", "sword", 5, 8),
      p("P-spear-1", "spear", 9, 13, { acted: true }),
    ]);
    const healed = await request(baseUrl)
      .get(`/api/games/${game.id}/preview/P-healer-1`)
      .set("Cookie", cookie);
    expect(healed.status).toBe(200);
    expect(healed.body.healTiles).toEqual([[5, 6]]);
    expect(healed.body.side).toBe("player");

    for (const unitId of ["P-spear-1", "P-nobody-9"]) {
      const res = await request(baseUrl)
        .get(`/api/games/${game.id}/preview/${unitId}`)
        .set("Cookie", cookie);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Unit not playable" });
    }
  });

  it("endpoint 12: 409 when the game is not waiting for the player's turn", async () => {
    const register = await registerUser();
    const cookie = cookieOf(register);
    const game = await insertCraftedGame(
      register.body.user.id,
      [p("P-sword-1", "sword", 5, 7)],
      "ai_turn",
    );
    const res = await request(baseUrl)
      .get(`/api/games/${game.id}/preview/P-sword-1`)
      .set("Cookie", cookie);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "Game is not waiting for your turn" });
  });

  it("endpoint 13: applies the bundle atomically; wait entries count as acted; counters resolve", async () => {
    const register = await registerUser();
    const cookie = cookieOf(register);
    const game = await insertCraftedGame(register.body.user.id, [
      p("P-sword-1", "sword", 5, 7),
      p("P-archer-1", "archer", 6, 7),
      e("E-spear-1", "spear", 5, 5),
    ]);
    const res = await request(baseUrl)
      .post(`/api/games/${game.id}/moves`)
      .set("Cookie", cookie)
      .send({
        moves: [
          {
            unitId: "P-sword-1",
            path: [
              [5, 7],
              [5, 6],
            ],
            action: { type: "attack", targetId: "E-spear-1" },
          },
          { unitId: "P-archer-1", path: [[6, 7]], action: { type: "wait" } },
        ],
      });
    expect(res.status).toBe(200);
    const units = res.body.game.units as Array<{
      id: string;
      x: number;
      hp: number;
      acted: boolean;
    }>;
    expect(units.find((u) => u.id === "P-sword-1")).toMatchObject({
      x: 5,
      y: 6,
      hp: 19, // spear countered: 6 atk − 5 def
      acted: true,
    });
    expect(units.find((u) => u.id === "E-spear-1")).toMatchObject({
      hp: 14, // 7 atk − 3 def
      acted: false,
    });
    expect(units.find((u) => u.id === "P-archer-1")?.acted).toBe(true);
    expect(res.body.game.status).toBe("player_turn");
  });

  it("endpoint 13: illegal bundle → 400 'move 1: <engine message>', row untouched, round UNLOCKED", async () => {
    const register = await registerUser();
    const cookie = cookieOf(register);
    const game = await insertCraftedGame(register.body.user.id, [
      p("P-archer-1", "archer", 6, 7),
      e("E-spear-1", "spear", 5, 5),
    ]);
    const before = await pool.query(
      "SELECT units, moves_applied, updated_at FROM games WHERE id = $1",
      [game.id],
    );
    const res = await request(baseUrl)
      .post(`/api/games/${game.id}/moves`)
      .set("Cookie", cookie)
      .send({
        moves: [
          {
            unitId: "P-archer-1",
            path: [[6, 7]],
            action: { type: "attack", targetId: "E-spear-1" }, // 3 tiles, range [2]
          },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: "move 1: archer cannot attack a unit at 3 tiles",
    });
    const after = await pool.query(
      "SELECT units, moves_applied, updated_at FROM games WHERE id = $1",
      [game.id],
    );
    expect(after.rows[0]).toEqual(before.rows[0]); // atomic: DB row untouched

    // failed attempts do not consume the budget — the corrected bundle applies
    const fixed = await request(baseUrl)
      .post(`/api/games/${game.id}/moves`)
      .set("Cookie", cookie)
      .send({
        moves: [
          {
            unitId: "P-archer-1",
            path: [
              [6, 7],
              [6, 6],
            ],
            action: { type: "attack", targetId: "E-spear-1" }, // now 2 tiles
          },
        ],
      });
    expect(fixed.status).toBe(200);
    const units = fixed.body.game.units as Array<{ id: string; hp: number }>;
    expect(units.find((u) => u.id === "E-spear-1")?.hp).toBe(15);
  });

  it("endpoint 13: an EMPTY bundle is valid and consumes the budget — the lock is RESTART-PROOF", async () => {
    const register = await registerUser();
    const cookie = cookieOf(register);
    const game = await insertCraftedGame(register.body.user.id, [
      p("P-sword-1", "sword", 5, 7),
      e("E-sword-1", "sword", 12, 12), // keeps the game in player_turn
    ]);
    const first = await request(baseUrl)
      .post(`/api/games/${game.id}/moves`)
      .set("Cookie", cookie)
      .send({ moves: [] });
    expect(first.status).toBe(200);
    expect(first.body.game.status).toBe("player_turn");

    // a server restart mid-round: the lock is schema-borne (games.moves_applied),
    // NOT in-process — a fresh app instance still refuses the second submission
    const restarted = createApp();
    const second = await request(restarted)
      .post(`/api/games/${game.id}/moves`)
      .set("Cookie", cookie)
      .send({
        moves: [
          { unitId: "P-sword-1", path: [[5, 7]], action: { type: "wait" } },
        ],
      });
    expect(second.status).toBe(409);
    expect(second.body).toEqual({ error: "Turn moves already submitted" });
  });

  it("endpoint 13: a SECOND applied submission in one round → 409", async () => {
    const register = await registerUser();
    const cookie = cookieOf(register);
    const game = await insertCraftedGame(register.body.user.id, [
      p("P-sword-1", "sword", 5, 7),
      p("P-spear-1", "spear", 6, 9),
      e("E-sword-1", "sword", 12, 12), // keeps the game in player_turn
    ]);
    const first = await request(baseUrl)
      .post(`/api/games/${game.id}/moves`)
      .set("Cookie", cookie)
      .send({
        moves: [
          { unitId: "P-sword-1", path: [[5, 7]], action: { type: "wait" } },
        ],
      });
    expect(first.status).toBe(200);
    const second = await request(baseUrl)
      .post(`/api/games/${game.id}/moves`)
      .set("Cookie", cookie)
      .send({
        moves: [
          { unitId: "P-spear-1", path: [[6, 9]], action: { type: "wait" } },
        ],
      });
    expect(second.status).toBe(409);
    expect(second.body).toEqual({ error: "Turn moves already submitted" });
  });

  it("endpoint 13 EVOLVING landing: chain-follow SUCCEEDS — a later entry lands on a vacated tile", async () => {
    const register = await registerUser();
    const cookie = cookieOf(register);
    const game = await insertCraftedGame(register.body.user.id, [
      p("P-sword-1", "sword", 4, 5),
      p("P-spear-1", "spear", 4, 4),
    ]);
    const res = await request(baseUrl)
      .post(`/api/games/${game.id}/moves`)
      .set("Cookie", cookie)
      .send({
        moves: [
          // sword vacates (4,5) first
          {
            unitId: "P-sword-1",
            path: [
              [4, 5],
              [5, 5],
            ],
            action: { type: "wait" },
          },
          // spear lands on the sword's vacated origin — legal in bundle order
          {
            unitId: "P-spear-1",
            path: [
              [4, 4],
              [4, 5],
            ],
            action: { type: "wait" },
          },
        ],
      });
    expect(res.status).toBe(200);
    const units = res.body.game.units as Array<{
      id: string;
      x: number;
      y: number;
    }>;
    expect(units.find((u) => u.id === "P-sword-1")).toMatchObject({
      x: 5,
      y: 5,
    });
    expect(units.find((u) => u.id === "P-spear-1")).toMatchObject({
      x: 4,
      y: 5,
    });
  });

  it("endpoint 13 EVOLVING landing: swap-by-order works; the dirty order still rejects", async () => {
    const register = await registerUser();
    const cookie = cookieOf(register);
    // B first vacates its origin, A takes it — the ordered positional swap
    const game = await insertCraftedGame(register.body.user.id, [
      p("P-sword-1", "sword", 4, 5),
      p("P-spear-1", "spear", 5, 5),
    ]);
    const ordered = await request(baseUrl)
      .post(`/api/games/${game.id}/moves`)
      .set("Cookie", cookie)
      .send({
        moves: [
          {
            unitId: "P-spear-1",
            path: [
              [5, 5],
              [6, 5],
            ],
            action: { type: "wait" },
          },
          {
            unitId: "P-sword-1",
            path: [
              [4, 5],
              [5, 5],
            ],
            action: { type: "wait" },
          },
        ],
      });
    expect(ordered.status).toBe(200);
    const units = ordered.body.game.units as Array<{
      id: string;
      x: number;
      y: number;
    }>;
    expect(units.find((u) => u.id === "P-spear-1")).toMatchObject({
      x: 6,
      y: 5,
    });
    expect(units.find((u) => u.id === "P-sword-1")).toMatchObject({
      x: 5,
      y: 5,
    });

    // dirty swap: A tries to take B's still-occupied tile — rejects untouched
    const dirty = await insertCraftedGame(register.body.user.id, [
      p("P-sword-2", "sword", 4, 6),
      p("P-spear-2", "spear", 5, 6),
    ]);
    const rejected = await request(baseUrl)
      .post(`/api/games/${dirty.id}/moves`)
      .set("Cookie", cookie)
      .send({
        moves: [
          {
            unitId: "P-sword-2",
            path: [
              [4, 6],
              [5, 6],
            ],
            action: { type: "wait" },
          },
        ],
      });
    expect(rejected.status).toBe(400);
    expect(rejected.body).toEqual({
      error:
        "move 1: tile (5,6) is occupied in the current position of the turn chain",
    });
  });

  it("endpoint 13 EVOLVING landing: two entries claiming ONE evolving tile reject; entering a still-occupied tile rejects", async () => {
    const register = await registerUser();
    const cookie = cookieOf(register);
    const game = await insertCraftedGame(register.body.user.id, [
      p("P-sword-1", "sword", 4, 5),
      p("P-spear-1", "spear", 6, 5),
    ]);
    const res = await request(baseUrl)
      .post(`/api/games/${game.id}/moves`)
      .set("Cookie", cookie)
      .send({
        moves: [
          {
            unitId: "P-sword-1",
            path: [
              [4, 5],
              [5, 5],
            ],
            action: { type: "wait" },
          },
          {
            unitId: "P-spear-1",
            path: [
              [6, 5],
              [5, 5],
            ],
            action: { type: "wait" },
          },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: "move 2: tile (5,5) is claimed by two moves",
    });

    const still = await insertCraftedGame(register.body.user.id, [
      p("P-sword-2", "sword", 4, 6),
      p("P-spear-2", "spear", 5, 6),
    ]);
    const occupied = await request(baseUrl)
      .post(`/api/games/${still.id}/moves`)
      .set("Cookie", cookie)
      .send({
        moves: [
          { unitId: "P-spear-2", path: [[5, 6]], action: { type: "wait" } },
          {
            unitId: "P-sword-2",
            path: [
              [4, 6],
              [5, 6],
            ],
            action: { type: "wait" },
          },
        ],
      });
    expect(occupied.status).toBe(400);
    expect(occupied.body).toEqual({
      error:
        "move 2: tile (5,6) is occupied in the current position of the turn chain",
    });
  });

  it("endpoint 13: victory short-circuit — all enemies wiped ⇒ won, and /end-turn is 409", async () => {
    const register = await registerUser();
    const cookie = cookieOf(register);
    const game = await insertCraftedGame(register.body.user.id, [
      p("P-sword-1", "sword", 5, 7),
      e("E-spear-1", "spear", 5, 6, { hp: 1 }), // dies to one hit (7 atk − 3 def)
    ]);
    const res = await request(baseUrl)
      .post(`/api/games/${game.id}/moves`)
      .set("Cookie", cookie)
      .send({
        moves: [
          {
            unitId: "P-sword-1",
            path: [[5, 7]],
            action: { type: "attack", targetId: "E-spear-1" },
          },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.game.status).toBe("won");
    const end = await request(baseUrl)
      .post(`/api/games/${game.id}/end-turn`)
      .set("Cookie", cookie);
    expect(end.status).toBe(409);
    expect(end.body).toEqual({ error: "Game is not waiting for your turn" });
  });

  it("endpoint 13: zod shape-failures produce the generic first-issue body", async () => {
    const register = await registerUser();
    const cookie = cookieOf(register);
    const game = await insertCraftedGame(register.body.user.id, [
      p("P-sword-1", "sword", 5, 7),
    ]);
    const res = await request(baseUrl)
      .post(`/api/games/${game.id}/moves`)
      .set("Cookie", cookie)
      .send({
        moves: [{ unitId: "P-sword-1", path: [], action: { type: "wait" } }],
      });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
  });

  it("endpoint 13: 409 when the game is not in player_turn", async () => {
    const register = await registerUser();
    const cookie = cookieOf(register);
    const game = await insertCraftedGame(
      register.body.user.id,
      [p("P-sword-1", "sword", 5, 7)],
      "ai_turn",
    );
    const res = await request(baseUrl)
      .post(`/api/games/${game.id}/moves`)
      .set("Cookie", cookie)
      .send({ moves: [] });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "Game is not waiting for your turn" });
  });

  it("mock-LLM full loop: create → moves → end-turn → job applies → status flips, lastAiActions populated", async () => {
    const register = await registerUser();
    const cookie = cookieOf(register);
    const userId = register.body.user.id as string;
    // a REAL spawn layout whose E-sword-1 stands exactly where turn.valid.json
    // expects it — the created game and the fixture are mutually consistent
    let seed = 1;
    for (;;) {
      const sword = assembleArmies(seed, engineConfig).find(
        (candidate) => candidate.id === "E-sword-1",
      );
      if (sword !== undefined && sword.x === 5 && sword.y === 1) break;
      seed += 1;
    }
    const armies = assembleArmies(seed, engineConfig);
    const row = await insertGame({
      id: randomUUID(),
      userId,
      difficulty: "aggressive",
      board: makeBoard(),
      units: armies,
      usedFallback: false,
    });
    const playerSword = armies.find((u) => u.id === "P-sword-1");
    expect(playerSword).toBeDefined();

    const submitted = await request(baseUrl)
      .post(`/api/games/${row.id}/moves`)
      .set("Cookie", cookie)
      .send({
        moves: [
          {
            unitId: "P-sword-1",
            path: [
              [playerSword!.x, playerSword!.y],
              [playerSword!.x, playerSword!.y - 1],
            ],
            action: { type: "wait" },
          },
        ],
      });
    expect(submitted.status).toBe(200);
    expect(submitted.body.game.status).toBe("player_turn");

    const ended = await request(baseUrl)
      .post(`/api/games/${row.id}/end-turn`)
      .set("Cookie", cookie);
    expect(ended.status).toBe(200);
    expect(ended.body.game.status).toBe("ai_turn");
    // the acted reset covers BOTH armies in one stroke (docs/06 endpoint 14)
    for (const unit of ended.body.game.units as Array<{ acted: boolean }>) {
      expect(unit.acted).toBe(false);
    }

    // the background job applies the enemy turn
    await vi.waitFor(async () => {
      const after = await pool.query(
        "SELECT status, turn_number, last_ai_actions, ai_last_error FROM games WHERE id = $1",
        [row.id],
      );
      expect(after.rows[0]).toMatchObject({
        status: "player_turn",
        turn_number: 2,
        ai_last_error: null,
      });
      expect(after.rows[0].last_ai_actions).toEqual([
        {
          unitId: "E-sword-1",
          path: [
            [5, 1],
            [5, 2],
          ],
          action: { type: "wait" },
          outcome: null,
        },
      ]);
    });
    const dto = await request(baseUrl)
      .get(`/api/games/${row.id}`)
      .set("Cookie", cookie);
    expect(dto.body.game.lastAiActions).toEqual([
      {
        unitId: "E-sword-1",
        path: [
          [5, 1],
          [5, 2],
        ],
        action: { type: "wait" },
        outcome: null,
      },
    ]);
  });

  it("endpoint 14: turnNumber stays; a second end-turn during ai_turn is 409", async () => {
    const register = await registerUser();
    const cookie = cookieOf(register);
    const game = await insertCraftedGame(register.body.user.id, [
      p("P-sword-1", "sword", 5, 7),
      e("E-sword-1", "sword", 5, 1),
    ]);
    // the job exhausts (stays ai_turn) so the round genuinely persists
    queueTurnFixtures(
      "turn.exhausting.json",
      "turn.exhausting.json",
      "turn.exhausting.json",
    );
    const first = await request(baseUrl)
      .post(`/api/games/${game.id}/end-turn`)
      .set("Cookie", cookie);
    expect(first.status).toBe(200);
    expect(first.body.game).toMatchObject({ status: "ai_turn", turnNumber: 1 });
    await vi.waitFor(async () => {
      const after = await getGameById(game.id);
      expect(after).toMatchObject({
        status: "ai_turn",
        ai_last_error: expect.any(String),
      });
    });
    const second = await request(baseUrl)
      .post(`/api/games/${game.id}/end-turn`)
      .set("Cookie", cookie);
    expect(second.status).toBe(409);
    expect(second.body).toEqual({ error: "Game is not waiting for your turn" });
  });

  it("endpoint 14: all enemies already dead ⇒ won directly, no AI turn happens", async () => {
    const register = await registerUser();
    const cookie = cookieOf(register);
    const game = await insertCraftedGame(register.body.user.id, [
      p("P-sword-1", "sword", 5, 7),
    ]);
    const res = await request(baseUrl)
      .post(`/api/games/${game.id}/end-turn`)
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.game.status).toBe("won");
    expect(res.body.game.turnNumber).toBe(1);
  });

  it("endpoint 15: forfeit from player_turn or ai_turn ⇒ lost; repeats on finished are 409", async () => {
    const register = await registerUser();
    const cookie = cookieOf(register);
    const userId = register.body.user.id as string;
    const active = await insertCraftedGame(userId, [
      p("P-sword-1", "sword", 5, 7),
    ]);
    const thinking = await insertCraftedGame(
      userId,
      [p("P-sword-1", "sword", 5, 7)],
      "ai_turn",
    );
    const resigned = await request(baseUrl)
      .post(`/api/games/${active.id}/forfeit`)
      .set("Cookie", cookie);
    expect(resigned.status).toBe(200);
    expect(resigned.body.game.status).toBe("lost");
    const repeat = await request(baseUrl)
      .post(`/api/games/${active.id}/forfeit`)
      .set("Cookie", cookie);
    expect(repeat.status).toBe(409);
    expect(repeat.body).toEqual({ error: "Game already finished" });
    const midThinking = await request(baseUrl)
      .post(`/api/games/${thinking.id}/forfeit`)
      .set("Cookie", cookie);
    expect(midThinking.status).toBe(200);
    expect(midThinking.body.game.status).toBe("lost");
  });
});
