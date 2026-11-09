import { randomUUID } from "node:crypto";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../app.js";
import { getConfig, toEngineConfig } from "../../config/config.js";
import { getPool } from "../../db/pool.js";
import { plainBoard, unit } from "../../test-game.js";
import { useTestDb } from "../../test-db.js";
import { uniqueEmail, uniqueUsername } from "../../test-ids.js";
import type { Unit } from "../../game/types.js";
import type { GameRow } from "./game.dto.js";
import { insertGame, getGameById } from "./games.queries.js";
import { placeArmies } from "../board/spawn.js";
import { queueTurnFixtures, resetTurnFixtures } from "../ai/mockLlm.js";

const app = createApp();

function cookieOf(res: request.Response): string {
  return (res.headers["set-cookie"] as unknown as string[])[0];
}

async function registerAndGetCookie(): Promise<{
  cookie: string;
  userId: string;
}> {
  const res = await request(app).post("/api/auth/register").send({
    email: uniqueEmail(),
    password: "correct-horse",
    username: uniqueUsername(),
  });
  expect(res.status).toBe(201);
  const me = await request(app).get("/api/me").set("Cookie", cookieOf(res));
  return { cookie: cookieOf(res), userId: me.body.user.id as string };
}

async function insertCraftedGame(
  userId: string,
  units: Unit[],
  status: GameRow["status"] = "player_turn",
): Promise<GameRow> {
  const row = await insertGame({
    id: randomUUID(),
    userId,
    difficulty: "aggressive",
    board: plainBoard(15),
    units,
    usedFallback: false,
  });
  if (status !== "player_turn") {
    await getPool().query("UPDATE games SET status = $2 WHERE id = $1", [
      row.id,
      status,
    ]);
  }
  return row;
}

beforeEach(() => {
  resetTurnFixtures();
});

useTestDb();

describe("endpoints 9/11-15 and 8 — contract conformance (06)", () => {
  it("401 Not authenticated on every new endpoint without a session", async () => {
    const id = randomUUID();
    for (const attempt of [
      () => request(app).get("/api/games"),
      () => request(app).get(`/api/games/${id}`),
      () => request(app).get(`/api/games/${id}/preview/P-sword-1`),
      () => request(app).post(`/api/games/${id}/moves`).send({ moves: [] }),
      () => request(app).post(`/api/games/${id}/end-turn`),
      () => request(app).post(`/api/games/${id}/forfeit`),
      () => request(app).get("/api/stats"),
    ]) {
      const res = await attempt();
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "Not authenticated" });
    }
  });

  it("404 Not found for another user's game — existence is never leaked", async () => {
    const owner = await registerAndGetCookie();
    const game = await insertCraftedGame(owner.userId, [
      unit("P-sword-1", "player", "sword", 5, 7, 20),
      unit("E-sword-1", "enemy", "sword", 5, 5, 20),
    ]);
    const outsider = await registerAndGetCookie();
    for (const attempt of [
      () =>
        request(app)
          .get(`/api/games/${game.id}`)
          .set("Cookie", outsider.cookie),
      () =>
        request(app)
          .get(`/api/games/${game.id}/preview/P-sword-1`)
          .set("Cookie", outsider.cookie),
      () =>
        request(app)
          .post(`/api/games/${game.id}/moves`)
          .send({ moves: [] })
          .set("Cookie", outsider.cookie),
      () =>
        request(app)
          .post(`/api/games/${game.id}/end-turn`)
          .set("Cookie", outsider.cookie),
      () =>
        request(app)
          .post(`/api/games/${game.id}/forfeit`)
          .set("Cookie", outsider.cookie),
    ]) {
      const res = await attempt();
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Not found" });
    }
  });

  it("endpoint 9: creation-ordered summaries; finished games stay in place", async () => {
    const { cookie, userId } = await registerAndGetCookie();
    const first = await insertCraftedGame(userId, [
      unit("P-sword-1", "player", "sword", 5, 7, 20),
    ]);
    const second = await insertCraftedGame(userId, [
      unit("P-sword-1", "player", "sword", 5, 7, 20),
    ]);
    await getPool().query("UPDATE games SET status = 'lost' WHERE id = $1", [
      first.id,
    ]);
    const third = await insertCraftedGame(userId, [
      unit("P-sword-1", "player", "sword", 5, 7, 20),
    ]);
    const res = await request(app).get("/api/games").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.games.map((g: { id: string }) => g.id)).toEqual([
      first.id,
      second.id,
      third.id,
    ]);
    for (const summary of res.body.games as Array<Record<string, unknown>>) {
      expect(Object.keys(summary).sort()).toEqual([
        "difficulty",
        "id",
        "status",
        "turnNumber",
        "updatedAt",
      ]);
      expect(typeof summary.turnNumber).toBe("number");
      expect(new Date(summary.updatedAt as string).toISOString()).toBe(
        summary.updatedAt,
      );
    }
  });

  it("endpoint 11: full GameState shape while ai_turn reflects the state at query time", async () => {
    const { cookie, userId } = await registerAndGetCookie();
    const game = await insertCraftedGame(
      userId,
      [
        unit("P-sword-1", "player", "sword", 5, 7, 20),
        unit("E-sword-1", "enemy", "sword", 5, 5, 20),
      ],
      "ai_turn",
    );
    const res = await request(app)
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
    expect(res.body.game.board.tiles).toHaveLength(15);
    expect(res.body.game.units).toHaveLength(2);
  });

  it("endpoint 12: preview — set-membership attackTiles (range [2] marks exactly 2)", async () => {
    const { cookie, userId } = await registerAndGetCookie();
    const board = plainBoard(15);
    // fence the archer in: (1,14) is water and the enemy at (0,13) blocks the
    // other exit — the ONLY reachable final tile is the archer's own (0,14)
    board.tiles[14][1] = "river";
    const game = await insertGame({
      id: randomUUID(),
      userId,
      difficulty: "aggressive",
      board,
      units: [
        unit("P-archer-1", "player", "archer", 0, 14, 16),
        // distance 2 from (0,14): inside the archer's range LIST
        unit("E-sword-2", "enemy", "sword", 1, 13, 20),
        // distance 1: NOT attackable — a range list is membership, not ≤ max
        unit("E-sword-1", "enemy", "sword", 0, 13, 20),
      ],
      usedFallback: false,
    });
    const res = await request(app)
      .get(`/api/games/${game.id}/preview/P-archer-1`)
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      moveTiles: [[0, 14]],
      attackTiles: [[1, 13]],
      healTiles: [],
    });
  });

  it("endpoint 12: healer preview lists wounded adjacent allies only; acted/foreign/unknown units are 'Unit not playable'", async () => {
    const { cookie, userId } = await registerAndGetCookie();
    const game = await insertCraftedGame(userId, [
      unit("P-healer-1", "player", "healer", 5, 7, 18),
      unit("P-sword-1", "player", "sword", 5, 6, 20, { hp: 9, maxHp: 20 }),
      unit("P-sword-2", "player", "sword", 4, 7, 20), // full hp — not healable
      unit("E-sword-1", "enemy", "sword", 5, 8, 20),
      unit("P-spear-1", "player", "spear", 9, 13, 18, { acted: true }),
    ]);
    const healed = await request(app)
      .get(`/api/games/${game.id}/preview/P-healer-1`)
      .set("Cookie", cookie);
    expect(healed.status).toBe(200);
    expect(healed.body.healTiles).toEqual([[5, 6]]);

    for (const unitId of ["P-spear-1", "E-sword-1", "P-nobody-9"]) {
      const res = await request(app)
        .get(`/api/games/${game.id}/preview/${unitId}`)
        .set("Cookie", cookie);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Unit not playable" });
    }
  });

  it("endpoint 12: 409 when the game is not waiting for the player's turn", async () => {
    const { cookie, userId } = await registerAndGetCookie();
    const game = await insertCraftedGame(
      userId,
      [unit("P-sword-1", "player", "sword", 5, 7, 20)],
      "ai_turn",
    );
    const res = await request(app)
      .get(`/api/games/${game.id}/preview/P-sword-1`)
      .set("Cookie", cookie);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "Game is not waiting for your turn" });
  });

  it("endpoint 13: applies the bundle atomically, sets acted on entries (wait included)", async () => {
    const { cookie, userId } = await registerAndGetCookie();
    const game = await insertCraftedGame(userId, [
      unit("P-sword-1", "player", "sword", 5, 7, 20),
      unit("P-archer-1", "player", "archer", 6, 7, 16),
      unit("E-spear-1", "enemy", "spear", 5, 5, 18),
    ]);
    const res = await request(app)
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
    const { cookie, userId } = await registerAndGetCookie();
    const game = await insertCraftedGame(userId, [
      unit("P-archer-1", "player", "archer", 6, 7, 16),
      unit("E-spear-1", "enemy", "spear", 5, 5, 18),
    ]);
    const before = await getPool().query(
      "SELECT units, moves_applied, updated_at FROM games WHERE id = $1",
      [game.id],
    );
    const res = await request(app)
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
    const after = await getPool().query(
      "SELECT units, moves_applied, updated_at FROM games WHERE id = $1",
      [game.id],
    );
    expect(after.rows[0]).toEqual(before.rows[0]); // atomic: DB row untouched

    // failed attempts do not consume the budget — the corrected bundle applies
    const fixed = await request(app)
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
    expect(
      fixed.body.game.units.find((u: { id: string }) => u.id === "E-spear-1")
        .hp,
    ).toBe(15);
  });

  it("endpoint 13: an EMPTY bundle is valid and consumes the budget — the lock is RESTART-PROOF", async () => {
    const { cookie, userId } = await registerAndGetCookie();
    const game = await insertCraftedGame(userId, [
      unit("P-sword-1", "player", "sword", 5, 7, 20),
      unit("E-sword-1", "enemy", "sword", 12, 12, 20), // keeps the game in player_turn
    ]);
    const first = await request(app)
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
          {
            unitId: "P-sword-1",
            path: [[5, 7]],
            action: { type: "wait" },
          },
        ],
      });
    expect(second.status).toBe(409);
    expect(second.body).toEqual({ error: "Turn moves already submitted" });
  });

  it("endpoint 13: a SECOND applied submission in one round → 409", async () => {
    const { cookie, userId } = await registerAndGetCookie();
    const game = await insertCraftedGame(userId, [
      unit("P-sword-1", "player", "sword", 5, 7, 20),
      unit("P-spear-1", "player", "spear", 6, 9, 18),
      unit("E-sword-1", "enemy", "sword", 12, 12, 20), // keeps the game in player_turn
    ]);
    const first = await request(app)
      .post(`/api/games/${game.id}/moves`)
      .set("Cookie", cookie)
      .send({
        moves: [
          { unitId: "P-sword-1", path: [[5, 7]], action: { type: "wait" } },
        ],
      });
    expect(first.status).toBe(200);
    const second = await request(app)
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

  it("endpoint 13: victory short-circuit — all enemies wiped ⇒ won, and /end-turn is 409", async () => {
    const { cookie, userId } = await registerAndGetCookie();
    const game = await insertCraftedGame(userId, [
      unit("P-sword-1", "player", "sword", 5, 7, 20),
      unit("E-spear-1", "enemy", "spear", 5, 6, 1), // dies to one hit (7 atk − 3 def)
    ]);
    const res = await request(app)
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
    const end = await request(app)
      .post(`/api/games/${game.id}/end-turn`)
      .set("Cookie", cookie);
    expect(end.status).toBe(409);
    expect(end.body).toEqual({ error: "Game is not waiting for your turn" });
  });

  it("endpoint 13: the player's army wiping ITSELF via counters ⇒ lost (06 status matrix)", async () => {
    const { cookie, userId } = await registerAndGetCookie();
    const game = await insertCraftedGame(userId, [
      unit("P-sword-1", "player", "sword", 5, 7, 1),
      unit("E-axe-1", "enemy", "axe", 5, 6, 25), // counter: 10 atk − 5 def ≥ 1 hp
    ]);
    const res = await request(app)
      .post(`/api/games/${game.id}/moves`)
      .set("Cookie", cookie)
      .send({
        moves: [
          {
            unitId: "P-sword-1",
            path: [[5, 7]],
            action: { type: "attack", targetId: "E-axe-1" },
          },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.game.status).toBe("lost");
  });

  it("endpoint 13: zod shape-failures produce the generic first-issue body", async () => {
    const { cookie, userId } = await registerAndGetCookie();
    const game = await insertCraftedGame(userId, [
      unit("P-sword-1", "player", "sword", 5, 7, 20),
    ]);
    const res = await request(app)
      .post(`/api/games/${game.id}/moves`)
      .set("Cookie", cookie)
      .send({
        moves: [{ unitId: "P-sword-1", path: [], action: { type: "wait" } }],
      });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
  });

  it("endpoint 13: 409 when the game is not in player_turn", async () => {
    const { cookie, userId } = await registerAndGetCookie();
    const game = await insertCraftedGame(
      userId,
      [unit("P-sword-1", "player", "sword", 5, 7, 20)],
      "ai_turn",
    );
    const res = await request(app)
      .post(`/api/games/${game.id}/moves`)
      .set("Cookie", cookie)
      .send({ moves: [] });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "Game is not waiting for your turn" });
  });

  it("mock-LLM full loop: create → moves → end-turn → job applies → status flips, lastAiActions populated", async () => {
    const { cookie, userId } = await registerAndGetCookie();
    // a REAL spawn layout whose E-sword-1 stands exactly where turn.valid.json
    // expects it — the created game and the fixture are mutually consistent
    const engineCfg = toEngineConfig(getConfig());
    let seed = 1;
    while (true) {
      const sword = placeArmies(seed, engineCfg).find(
        (candidate) => candidate.id === "E-sword-1",
      );
      if (sword !== undefined && sword.x === 5 && sword.y === 1) {
        break;
      }
      seed += 1;
    }
    const game = await insertGame({
      id: randomUUID(),
      userId,
      difficulty: "aggressive",
      board: plainBoard(15),
      units: placeArmies(seed, engineCfg),
      usedFallback: false,
    });

    const armies = placeArmies(seed, engineCfg);
    const playerSword = armies.find(
      (candidate) => candidate.id === "P-sword-1",
    );
    if (playerSword === undefined) {
      throw new Error("spawn has no P-sword-1");
    }
    const submitted = await request(app)
      .post(`/api/games/${game.id}/moves`)
      .set("Cookie", cookie)
      .send({
        moves: [
          {
            unitId: "P-sword-1",
            path: [
              [playerSword.x, playerSword.y],
              [playerSword.x, playerSword.y - 1],
            ],
            action: { type: "wait" },
          },
        ],
      });
    expect(submitted.status).toBe(200);
    expect(submitted.body.game.status).toBe("player_turn");

    const ended = await request(app)
      .post(`/api/games/${game.id}/end-turn`)
      .set("Cookie", cookie);
    expect(ended.status).toBe(200);
    expect(ended.body.game.status).toBe("ai_turn");
    // the acted reset covers BOTH armies in one stroke (06 ep. 14)
    for (const restored of ended.body.game.units as Array<{ acted: boolean }>) {
      expect(restored.acted).toBe(false);
    }

    // the background job applies the enemy turn
    await vi.waitFor(async () => {
      const row = await getPool().query(
        "SELECT status, turn_number, last_ai_actions, ai_last_error FROM games WHERE id = $1",
        [game.id],
      );
      expect(row.rows[0]).toMatchObject({
        status: "player_turn",
        turn_number: 2,
        ai_last_error: null,
      });
      expect(row.rows[0].last_ai_actions).toEqual([
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
  });

  it("endpoint 14: turnNumber stays; a second end-turn during ai_turn is 409", async () => {
    const { cookie, userId } = await registerAndGetCookie();
    const game = await insertCraftedGame(userId, [
      unit("P-sword-1", "player", "sword", 5, 7, 20),
      unit("E-sword-1", "enemy", "sword", 5, 1, 20),
    ]);
    // the job exhausts (stays ai_turn) so the round genuinely persists
    queueTurnFixtures(
      "turn.exhausting.json",
      "turn.exhausting.json",
      "turn.exhausting.json",
    );
    const first = await request(app)
      .post(`/api/games/${game.id}/end-turn`)
      .set("Cookie", cookie);
    expect(first.status).toBe(200);
    expect(first.body.game).toMatchObject({ status: "ai_turn", turnNumber: 1 });
    await vi.waitFor(async () => {
      const row = await getGameById(game.id);
      expect(row).toMatchObject({
        status: "ai_turn",
        ai_last_error: expect.any(String),
      });
    });
    const second = await request(app)
      .post(`/api/games/${game.id}/end-turn`)
      .set("Cookie", cookie);
    expect(second.status).toBe(409);
    expect(second.body).toEqual({ error: "Game is not waiting for your turn" });
  });

  it("endpoint 14: all enemies already dead ⇒ won directly, no AI turn happens", async () => {
    const { cookie, userId } = await registerAndGetCookie();
    const game = await insertCraftedGame(userId, [
      unit("P-sword-1", "player", "sword", 5, 7, 20),
    ]);
    const res = await request(app)
      .post(`/api/games/${game.id}/end-turn`)
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.game.status).toBe("won");
    expect(res.body.game.turnNumber).toBe(1);
  });

  it("endpoint 15: forfeit from player_turn or ai_turn ⇒ lost; repeats on finished are 409", async () => {
    const { cookie, userId } = await registerAndGetCookie();
    const active = await insertCraftedGame(userId, [
      unit("P-sword-1", "player", "sword", 5, 7, 20),
    ]);
    const thinking = await insertCraftedGame(
      userId,
      [unit("P-sword-1", "player", "sword", 5, 7, 20)],
      "ai_turn",
    );
    const resigned = await request(app)
      .post(`/api/games/${active.id}/forfeit`)
      .set("Cookie", cookie);
    expect(resigned.status).toBe(200);
    expect(resigned.body.game.status).toBe("lost");
    const repeat = await request(app)
      .post(`/api/games/${active.id}/forfeit`)
      .set("Cookie", cookie);
    expect(repeat.status).toBe(409);
    expect(repeat.body).toEqual({ error: "Game already finished" });
    const midThinking = await request(app)
      .post(`/api/games/${thinking.id}/forfeit`)
      .set("Cookie", cookie);
    expect(midThinking.status).toBe(200);
    expect(midThinking.body.game.status).toBe("lost");
  });
});
