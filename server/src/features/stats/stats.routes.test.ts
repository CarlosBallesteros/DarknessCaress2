import { randomUUID } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { getPool } from "../../db/pool.js";
import { useTestDb } from "../../test-db.js";
import { uniqueEmail, uniqueUsername } from "../../test-ids.js";

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

async function seedFinished(
  userId: string,
  difficulty: string,
  status: "won" | "lost",
  count: number,
): Promise<void> {
  for (let i = 0; i < count; i++) {
    await getPool().query(
      "INSERT INTO games (id, user_id, difficulty, status, board, units) VALUES ($1, $2, $3, $4, $5, $6)",
      [
        randomUUID(),
        userId,
        difficulty,
        status,
        JSON.stringify({ tiles: [] }),
        JSON.stringify([]),
      ],
    );
  }
}

describe("GET /api/stats (endpoint 8 of 06)", () => {
  useTestDb();

  it("aggregates finished rows per 06's example body; games in flight are excluded", async () => {
    const cookie = await registerAndGetCookie();
    const me = await request(app).get("/api/me").set("Cookie", cookie);
    const userId = me.body.user.id as string;

    await seedFinished(userId, "aggressive", "won", 3);
    await seedFinished(userId, "aggressive", "lost", 2);
    await seedFinished(userId, "defensive", "won", 3);
    await seedFinished(userId, "defensive", "lost", 1);
    await seedFinished(userId, "erratic", "won", 1);
    await seedFinished(userId, "erratic", "lost", 2);
    // games in flight never count
    await seedFinished(userId, "aggressive", "player_turn" as never, 1);
    await seedFinished(userId, "defensive", "ai_turn" as never, 1);

    const res = await request(app).get("/api/stats").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      gamesPlayed: 12,
      wins: 7,
      losses: 5,
      winRate: 0.583,
      byDifficulty: [
        { difficulty: "aggressive", played: 5, wins: 3, losses: 2 },
        { difficulty: "defensive", played: 4, wins: 3, losses: 1 },
        { difficulty: "erratic", played: 3, wins: 1, losses: 2 },
      ],
    });
  });

  it("byDifficulty ALWAYS carries one row per persona (zeros included, config order)", async () => {
    const cookie = await registerAndGetCookie();
    const res = await request(app).get("/api/stats").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      gamesPlayed: 0,
      wins: 0,
      losses: 0,
      winRate: 0, // floored to 0 when gamesPlayed = 0 — never NaN/null/omitted
      byDifficulty: [
        { difficulty: "aggressive", played: 0, wins: 0, losses: 0 },
        { difficulty: "defensive", played: 0, wins: 0, losses: 0 },
        { difficulty: "erratic", played: 0, wins: 0, losses: 0 },
      ],
    });
  });

  it("stats are per user — another player's games do not leak", async () => {
    const mine = await registerAndGetCookie();
    const theirs = await registerAndGetCookie();
    const me = await request(app).get("/api/me").set("Cookie", mine);
    await seedFinished(me.body.user.id as string, "erratic", "won", 2);
    const res = await request(app).get("/api/stats").set("Cookie", theirs);
    expect(res.body.gamesPlayed).toBe(0);
  });
});
