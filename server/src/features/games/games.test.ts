import { readFileSync } from "node:fs";
import path from "node:path";
import request from "supertest";
import type { Express } from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

process.env.DATABASE_URL ??= "postgres://dc:dc@127.0.0.1:5432/darknesscaress";
process.env.JWT_SECRET ??= "test-secret";
process.env.OLLAMA_URL ??= "http://localhost:11434";
process.env.OLLAMA_MODEL ??= "qwen2.5:7b-instruct-q4_K_M";
process.env.PORT ??= "3000";
process.env.NODE_ENV ??= "test";
process.env.LLM_MOCK = "1";

function unique(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function cookieHeader(res: request.Response): string {
  const raw = res.headers["set-cookie"];
  if (!raw) return "";
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr.map((c) => c.split(";")[0]).join("; ");
}

async function waitForStatus(
  app: Express,
  cookie: string,
  gameId: string,
  status: string,
  timeoutMs = 10000,
): Promise<{
  status: string;
  units: Array<{ side: string; y: number; class: string; acted: boolean }>;
}> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await request(app).get(`/api/games/${gameId}`).set("Cookie", cookie);
    if (res.status === 200 && res.body?.game?.status === status) {
      return res.body.game as {
        status: string;
        units: Array<{ side: string; y: number; class: string; acted: boolean }>;
      };
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  const final = await request(app).get(`/api/games/${gameId}`).set("Cookie", cookie);
  throw new Error(
    `Timed out waiting for status ${status}, got ${final.body?.game?.status} (${JSON.stringify(final.body?.game?.aiLastError ?? final.body)})`,
  );
}

describe("games phase 4", async () => {
  const { app } = await import("../../app");
  const { pool } = await import("../../db/pool");
  const { clearActiveJobsForTests } = await import("./activeJobs");

  beforeAll(async () => {
    const schemaPath = path.resolve(__dirname, "../../db/schema.sql");
    const sql = readFileSync(schemaPath, "utf8");
    await pool.query(sql);
  });

  beforeEach(() => {
    clearActiveJobsForTests();
  });

  afterAll(async () => {
    // shared pool in-process
  });

  async function registerAndLogin() {
    const email = `${unique("g")}@example.com`;
    const username = unique("u").slice(0, 18);
    const password = "correct-horse";
    const reg = await request(app).post("/api/auth/register").send({ email, username, password });
    expect(reg.status).toBe(201);
    return cookieHeader(reg);
  }

  it("mock-LLM full flow: POST creates generating game then job resolves to player_turn with armies", async () => {
    const cookie = await registerAndLogin();
    const created = await request(app)
      .post("/api/games")
      .set("Cookie", cookie)
      .send({ difficulty: "aggressive" });
    expect(created.status).toBe(202);
    expect(created.body.game.status).toBe("generating_board");
    expect(created.body.game.turnNumber).toBe(1);
    expect(created.body.game.units).toEqual([]);
    expect(created.body.game.board.tiles).toHaveLength(8);
    expect(
      created.body.game.board.tiles.every((row: string[]) => row.every((t) => t === "plain")),
    ).toBe(true);
    expect(created.body.game.lastAiActions).toBeNull();

    const gameId = created.body.game.id as string;
    const ready = await waitForStatus(app, cookie, gameId, "player_turn");
    expect(ready.units).toHaveLength(20);
    const players = ready.units.filter((u: { side: string }) => u.side === "player");
    const enemies = ready.units.filter((u: { side: string }) => u.side === "enemy");
    expect(players).toHaveLength(10);
    expect(enemies).toHaveLength(10);

    // armies placed per 03's spawn scatter layout (2 full rows, composition, healer never front)
    for (const side of ["player", "enemy"]) {
      const sideUnits = ready.units.filter((u: { side: string }) => u.side === side);
      const frontRow = side === "player" ? 6 : 1;
      const backRow = side === "player" ? 7 : 0;
      expect(sideUnits.filter((u: { y: number }) => u.y === frontRow)).toHaveLength(5);
      expect(sideUnits.filter((u: { y: number }) => u.y === backRow)).toHaveLength(5);
      expect(sideUnits.find((u: { class: string }) => u.class === "healer")?.y).toBe(backRow);
      expect(sideUnits.every((u: { acted: boolean }) => u.acted === false)).toBe(true);
    }

    // GET reflects current state
    const got = await request(app).get(`/api/games/${gameId}`).set("Cookie", cookie);
    expect(got.status).toBe(200);
    expect(got.body.game.status).toBe("player_turn");
  });

  it("409 on 6th active game (generating_board counts as active)", async () => {
    const cookie = await registerAndLogin();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post("/api/games")
        .set("Cookie", cookie)
        .send({ difficulty: "aggressive" });
      expect(res.status).toBe(202);
      expect(res.body.game.status).toBe("generating_board");
      ids.push(res.body.game.id);
    }

    const sixth = await request(app)
      .post("/api/games")
      .set("Cookie", cookie)
      .send({ difficulty: "aggressive" });
    expect(sixth.status).toBe(409);
    expect(sixth.body).toEqual({ error: "Active game limit reached (5)" });

    // let background jobs settle (avoid leaking active work across tests best-effort)
    for (const id of ids) {
      try {
        await waitForStatus(app, cookie, id, "player_turn", 10000);
      } catch {
        // ignore
      }
    }
  });

  it("GET returns 404 for missing/not-owned game", async () => {
    const cookie = await registerAndLogin();
    const missing = await request(app)
      .get("/api/games/00000000-0000-0000-0000-000000000000")
      .set("Cookie", cookie);
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: "Not found" });
  });

  it("POST rejects unknown difficulty", async () => {
    const cookie = await registerAndLogin();
    const res = await request(app)
      .post("/api/games")
      .set("Cookie", cookie)
      .send({ difficulty: "nope" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Unknown difficulty" });
  });
});
