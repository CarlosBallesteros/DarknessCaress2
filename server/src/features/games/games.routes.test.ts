import request from "supertest";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { getConfig } from "../../config/config.js";
import { getPool } from "../../db/pool.js";
import { useTestDb } from "../../test-db.js";
import { uniqueEmail, uniqueUsername } from "../../test-ids.js";
import { SPAWN_BLOCK_WIDTH, spawnBlockStart } from "../board/spawn.js";
import { insertGame } from "./games.queries.js";

const app = createApp();

function cookieOf(res: request.Response): string {
  return (res.headers["set-cookie"] as unknown as string[])[0];
}

async function registerAndGetCookie(): Promise<string> {
  const res = await request(app).post("/api/auth/register").send({
    email: uniqueEmail(),
    password: "correct-horse",
    username: uniqueUsername(),
  });
  expect(res.status).toBe(201);
  return cookieOf(res);
}

describe("POST /api/games (endpoint 10 of 06)", () => {
  useTestDb();

  it("401 Not authenticated without a session cookie", async () => {
    const res = await request(app)
      .post("/api/games")
      .send({ difficulty: "aggressive" });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Not authenticated" });
  });

  it("400 Unknown difficulty for a non-persona id", async () => {
    const cookie = await registerAndGetCookie();
    const res = await request(app)
      .post("/api/games")
      .set("Cookie", cookie)
      .send({ difficulty: "impossible" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Unknown difficulty" });
  });

  it("400 on a body without a difficulty (first zod issue)", async () => {
    const cookie = await registerAndGetCookie();
    const res = await request(app)
      .post("/api/games")
      .set("Cookie", cookie)
      .send({});
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
  });

  it("201 mock-LLM full flow: GameState with armies placed per 03's spawn scatter", async () => {
    const cookie = await registerAndGetCookie();
    const res = await request(app)
      .post("/api/games")
      .set("Cookie", cookie)
      .send({ difficulty: "aggressive" });
    expect(res.status).toBe(201);

    const game = res.body.game;
    expect(game).toMatchObject({
      difficulty: "aggressive",
      status: "player_turn",
      turnNumber: 1,
      lastAiActions: null,
    });
    expect(typeof game.id).toBe("string");
    expect(new Date(game.updatedAt).toISOString()).toBe(game.updatedAt);

    // board: 15×15 of tile codes, reserved rows forced plain
    const tiles = game.board.tiles as string[][];
    expect(tiles).toHaveLength(15);
    for (const row of tiles) {
      expect(row).toHaveLength(15);
    }
    for (const y of [0, 1, 13, 14]) {
      for (const tile of tiles[y] as string[]) {
        expect(tile).toBe("plain");
      }
    }

    // armies: 10 per side in the 8×2 block, 5 per row, healer never front
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
    const size = getConfig().boardSize;
    const blockStart = spawnBlockStart(size);
    const blockEnd = blockStart + SPAWN_BLOCK_WIDTH - 1;
    for (const side of ["player", "enemy"] as const) {
      const sideUnits = units.filter((u) => u.side === side);
      expect(sideUnits).toHaveLength(10);
      const frontRow = side === "player" ? size - 2 : 1;
      const backRow = side === "player" ? size - 1 : 0;
      for (const unit of sideUnits) {
        expect(unit.x).toBeGreaterThanOrEqual(blockStart);
        expect(unit.x).toBeLessThanOrEqual(blockEnd);
        expect(unit.acted).toBe(false);
        expect(unit.hp).toBe(unit.maxHp);
        expect([frontRow, backRow]).toContain(unit.y);
      }
      expect(sideUnits.filter((u) => u.y === frontRow)).toHaveLength(5);
      expect(sideUnits.filter((u) => u.y === backRow)).toHaveLength(5);
      expect(
        sideUnits.some((u) => u.class === "healer" && u.y === frontRow),
      ).toBe(false);
      const ids = sideUnits.map((u) => u.id);
      expect(ids).toContain(`${side === "player" ? "P" : "E"}-sword-1`);
      expect(ids).toContain(`${side === "player" ? "P" : "E"}-healer-1`);
    }

    // the row records the generation outcome (no fallback for the mock brief)
    const row = await getPool().query(
      "SELECT used_fallback, status, turn_number, difficulty FROM games WHERE id = $1",
      [game.id],
    );
    expect(row.rows[0]).toMatchObject({
      used_fallback: false,
      status: "player_turn",
      turn_number: 1,
      difficulty: "aggressive",
    });
  });

  it("used_fallback is recorded in the row when the fallback template fires", async () => {
    // The route passes the generation outcome straight into the insert; the
    // mock client never falls back, so the recording is exercised through the
    // production insert function with the fallback flag set.
    const cookie = await registerAndGetCookie();
    const me = await request(app).get("/api/me").set("Cookie", cookie);
    const row = await insertGame({
      id: randomUUID(),
      userId: me.body.user.id as string,
      difficulty: "erratic",
      board: { tiles: [] },
      units: [],
      usedFallback: true,
    });
    const read = await getPool().query(
      "SELECT used_fallback FROM games WHERE id = $1",
      [row.id],
    );
    expect(read.rows[0].used_fallback).toBe(true);
  });

  it("409 on the 6th active game — cap interpolated from config", async () => {
    const cookie = await registerAndGetCookie();
    const cap = getConfig().maxActiveGames;
    for (let created = 0; created < cap; created++) {
      const res = await request(app)
        .post("/api/games")
        .set("Cookie", cookie)
        .send({ difficulty: "defensive" });
      expect(res.status).toBe(201);
    }
    const sixth = await request(app)
      .post("/api/games")
      .set("Cookie", cookie)
      .send({ difficulty: "defensive" });
    expect(sixth.status).toBe(409);
    expect(sixth.body).toEqual({
      error: `Active game limit reached (${cap})`,
    });
  });

  it("finished games do not count against the cap", async () => {
    const cookie = await registerAndGetCookie();
    const cap = getConfig().maxActiveGames;
    const ids: string[] = [];
    for (let created = 0; created < cap; created++) {
      const res = await request(app)
        .post("/api/games")
        .set("Cookie", cookie)
        .send({ difficulty: "aggressive" });
      ids.push(res.body.game.id as string);
    }
    await getPool().query("UPDATE games SET status = 'lost' WHERE id = $1", [
      ids[0],
    ]);
    const freed = await request(app)
      .post("/api/games")
      .set("Cookie", cookie)
      .send({ difficulty: "aggressive" });
    expect(freed.status).toBe(201);
  });
});
