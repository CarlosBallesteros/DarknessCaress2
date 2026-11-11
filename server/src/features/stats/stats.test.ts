// GET /api/stats (docs/06 endpoint 8): computed from FINISHED game rows only;
// seeded outcomes match; byDifficulty always carries one row per persona in
// config (zeros included — stable table); winRate renders three decimals and
// floors to 0 when nothing is finished (never NaN/null/omitted).
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "../../app";
import { config } from "../../config/load";
import { migrate } from "../../db/migrate";
import { pool } from "../../db/pool";
import { insertGeneratingGame } from "../games/repo";

const app = createServer();
const EMAIL_DOMAIN = "dc2-stats.example";
const suffix = crypto.randomUUID().slice(0, 8);

type Res = { headers: Record<string, unknown> };

function cookieOf(res: Res): string {
  const setCookie = res.headers["set-cookie"];
  const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (typeof first !== "string") throw new Error("expected a Set-Cookie header");
  return first.split(";")[0];
}

async function registerUser(name: string): Promise<{ cookie: string; userId: string }> {
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

async function seedGame(userId: string, difficulty: string, status: string): Promise<void> {
  const game = await insertGeneratingGame({ id: crypto.randomUUID(), userId, difficulty });
  await pool.query("UPDATE games SET status = $2 WHERE id = $1", [game.id, status]);
}

beforeAll(async () => {
  await migrate();
});

afterAll(async () => {
  await pool.query("DELETE FROM users WHERE email LIKE $1", [`%@${EMAIL_DOMAIN}`]);
  await pool.end();
});

describe("GET /api/stats (docs/06 endpoint 8)", () => {
  it("401 Not authenticated without a session", async () => {
    const res = await request(app).get("/api/stats");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Not authenticated" });
  });

  it("a fresh user reads all zeros with the stable byDifficulty table", async () => {
    const { cookie } = await registerUser("empty");
    const res = await request(app).get("/api/stats").set("Cookie", cookie);
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

  it("matches the seeded outcomes: finished rows only, 2/3 renders as 0.667", async () => {
    const { cookie, userId } = await registerUser("seeded");
    // Aggressive: won, won, lost → played 3, wins 2, losses 1.
    await seedGame(userId, "aggressive", "won");
    await seedGame(userId, "aggressive", "won");
    await seedGame(userId, "aggressive", "lost");
    // In-flight rows are excluded — player_turn, ai_turn, generating_board.
    await seedGame(userId, "aggressive", "player_turn");
    await seedGame(userId, "defensive", "ai_turn");
    await seedGame(userId, "defensive", "generating_board");

    const res = await request(app).get("/api/stats").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      gamesPlayed: 3,
      wins: 2,
      losses: 1,
      winRate: 0.667, // 2/3 — the contract's example precision (0.583 for 7/12)
      byDifficulty: [
        { difficulty: "aggressive", played: 3, wins: 2, losses: 1 },
        { difficulty: "defensive", played: 0, wins: 0, losses: 0 },
        { difficulty: "erratic", played: 0, wins: 0, losses: 0 },
      ],
    });
  });
});
