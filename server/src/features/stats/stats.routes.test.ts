// Endpoint 8 tests (docs/06): statistics computed from finished game rows
// only, byDifficulty always one zero-included row per persona in config-key
// order, winRate floored to three decimals (0 when no finished games).
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../app";
import { pool } from "../../db/pool";
import { config } from "../../config/config";
import { makeBoard, p } from "../../game/fixtures";
import { insertGame } from "../games/games.repo";

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

// Seeds a finished game row directly — the stats read only won/lost rows, so
// the seeding IS the outcome table.
async function insertFinishedGame(
  userId: string,
  difficulty: string,
  status: "won" | "lost",
): Promise<void> {
  const row = await insertGame({
    id: randomUUID(),
    userId,
    difficulty,
    board: makeBoard(),
    units: [p("P-sword-1", "sword", 5, 7)],
    usedFallback: false,
  });
  await pool.query("UPDATE games SET status = $2 WHERE id = $1", [
    row.id,
    status,
  ]);
}

beforeAll(async () => {
  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
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

describe("GET /api/stats (docs/06 endpoint 8)", () => {
  it("401 Not authenticated without a session", async () => {
    const res = await request(baseUrl).get("/api/stats");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Not authenticated" });
  });

  it("a fresh user gets the stable zero table — one row per persona, winRate 0", async () => {
    const register = await request(baseUrl).post("/api/auth/register").send({
      email: uniqueEmail(),
      password: "correct-horse",
      username: uniqueUsername(),
    });
    expect(register.status).toBe(201);
    createdUserIds.push(register.body.user.id);
    const res = await request(baseUrl)
      .get("/api/stats")
      .set("Cookie", cookieOf(register));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      gamesPlayed: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      byDifficulty: Object.keys(config.personalities).map((difficulty) => ({
        difficulty,
        played: 0,
        wins: 0,
        losses: 0,
      })),
    });
  });

  it("matches the seeded outcomes; games in flight are excluded; winRate is floored to 3 decimals", async () => {
    const register = await request(baseUrl).post("/api/auth/register").send({
      email: uniqueEmail(),
      password: "correct-horse",
      username: uniqueUsername(),
    });
    expect(register.status).toBe(201);
    const userId = register.body.user.id as string;
    createdUserIds.push(userId);

    // seeded outcomes: 1 win (defensive) + 2 losses (aggressive, erratic) —
    // and one ai_turn game that must NOT count
    await insertFinishedGame(userId, "defensive", "won");
    await insertFinishedGame(userId, "aggressive", "lost");
    await insertFinishedGame(userId, "erratic", "lost");
    const inFlight = await insertGame({
      id: randomUUID(),
      userId,
      difficulty: "aggressive",
      board: makeBoard(),
      units: [p("P-sword-1", "sword", 5, 7)],
      usedFallback: false,
    });
    await pool.query("UPDATE games SET status = 'ai_turn' WHERE id = $1", [
      inFlight.id,
    ]);

    const res = await request(baseUrl)
      .get("/api/stats")
      .set("Cookie", cookieOf(register));
    expect(res.status).toBe(200);
    expect(res.body.gamesPlayed).toBe(3);
    expect(res.body.wins).toBe(1);
    expect(res.body.losses).toBe(2);
    expect(res.body.winRate).toBe(0.333); // 1/3 floored at three decimals
    expect(res.body.byDifficulty).toEqual([
      { difficulty: "aggressive", played: 1, wins: 0, losses: 1 },
      { difficulty: "defensive", played: 1, wins: 1, losses: 0 },
      { difficulty: "erratic", played: 1, wins: 0, losses: 1 },
    ]);
  });
});
