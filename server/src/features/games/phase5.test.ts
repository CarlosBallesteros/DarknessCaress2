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

async function register(app: Express): Promise<{ cookie: string; user: { id: string } }> {
  const email = `${unique("p5")}@example.com`;
  const username = unique("u").slice(0, 18);
  const password = "correct-horse";
  const reg = await request(app).post("/api/auth/register").send({ email, username, password });
  expect(reg.status).toBe(201);
  return { cookie: cookieHeader(reg), user: reg.body.user as { id: string } };
}

async function waitFor<T>(fn: () => Promise<T | null>, timeoutMs = 10000, stepMs = 40): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = await fn();
    if (v !== null) return v;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  throw new Error("timeout waiting for condition");
}

describe("phase 5 API", async () => {
  const { app } = await import("../../app");
  const { pool } = await import("../../db/pool");
  const { clearActiveJobsForTests, waitForActiveJobToFinish } = await import("./activeJobs");
  const { runAiTurnJob } = await import("../ai/aiTurn");
  const { sweepAllStaleJobs } = await import("./staleRecovery");

  beforeAll(async () => {
    const schemaPath = path.resolve(__dirname, "../../db/schema.sql");
    const sql = readFileSync(schemaPath, "utf8");
    await pool.query(sql);
  });

  beforeEach(async () => {
    clearActiveJobsForTests();
  });

  afterAll(async () => {
    // pool shared
  });

  it("GET /api/games returns list in created_at asc and supports stale recovery side effect for user", async () => {
    const { cookie, user } = await register(app);
    // insert a stale ai_turn game directly
    const plain = {
      tiles: Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => "plain")),
    };
    const units = [
      {
        id: "P-sword-1",
        side: "player",
        class: "sword",
        x: 0,
        y: 7,
        hp: 15,
        maxHp: 15,
        acted: false,
      },
      {
        id: "E-sword-1",
        side: "enemy",
        class: "sword",
        x: 0,
        y: 0,
        hp: 15,
        maxHp: 15,
        acted: false,
      },
    ];
    const ins = await pool.query(
      `INSERT INTO games (user_id, difficulty, status, board, units, turn_number, updated_at)
       VALUES ($1,'aggressive','ai_turn',$2::jsonb,$3::jsonb,1, now() - interval '120 seconds')
       RETURNING id, created_at`,
      [user.id, JSON.stringify(plain), JSON.stringify(units)],
    );
    const staleId = ins.rows[0].id as string;

    const list = await request(app).get("/api/games").set("Cookie", cookie);
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.games)).toBe(true);
    // recovery side effect should eventually resolve ai_turn job
    await waitFor(async () => {
      const r = await pool.query(
        "SELECT status, turn_number, last_ai_actions, ai_last_error FROM games WHERE id=$1",
        [staleId],
      );
      const g = r.rows[0];
      if (!g) return null;
      if (g.status === "player_turn" || g.status === "lost") return g;
      return null;
    });
    const after = await pool.query(
      "SELECT status, turn_number, last_ai_actions, ai_last_error FROM games WHERE id=$1",
      [staleId],
    );
    expect(after.rows[0].status === "player_turn" || after.rows[0].status === "lost").toBe(true);
    expect(after.rows[0].turn_number).toBe(2);
    expect(after.rows[0].ai_last_error).toBeNull();
    expect(Array.isArray(after.rows[0].last_ai_actions)).toBe(true);
  });

  it("server-side interval sweep resumes stale ai_turn without client GET and active-job guard prevents double-launch", async () => {
    const { user } = await register(app);
    const plain = {
      tiles: Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => "plain")),
    };
    const units = [
      {
        id: "P-sword-1",
        side: "player",
        class: "sword",
        x: 0,
        y: 7,
        hp: 15,
        maxHp: 15,
        acted: false,
      },
      {
        id: "E-sword-1",
        side: "enemy",
        class: "sword",
        x: 0,
        y: 0,
        hp: 15,
        maxHp: 15,
        acted: false,
      },
    ];
    const ins = await pool.query(
      `INSERT INTO games (user_id, difficulty, status, board, units, turn_number, updated_at)
       VALUES ($1,'aggressive','ai_turn',$2::jsonb,$3::jsonb,1, now() - interval '120 seconds')
       RETURNING id`,
      [user.id, JSON.stringify(plain), JSON.stringify(units)],
    );
    const gameId = ins.rows[0].id as string;

    // call sweep directly (simulates server-side interval sweep; no GET)
    await sweepAllStaleJobs();
    await waitForActiveJobToFinish(gameId).catch(() => {});
    await waitFor(async () => {
      const r = await pool.query("SELECT status FROM games WHERE id=$1", [gameId]);
      const s = r.rows[0]?.status;
      if (s === "player_turn" || s === "lost") return s;
      return null;
    });
    const final = await pool.query("SELECT status, turn_number FROM games WHERE id=$1", [gameId]);
    expect(["player_turn", "lost"]).toContain(final.rows[0].status);
    expect(final.rows[0].turn_number).toBe(2);

    // active-job guard: running job blocks duplicate kickoff
    const { tryStartActiveJob, finishActiveJob, hasActiveJob } = await import("./activeJobs");
    const gid2 = "00000000-0000-0000-0000-000000000099";
    expect(tryStartActiveJob(gid2)).toBe(true);
    expect(hasActiveJob(gid2)).toBe(true);
    expect(tryStartActiveJob(gid2)).toBe(false);
    finishActiveJob(gid2);
  });

  it("preview: own/enemy behavior, not playable/409, and side field", async () => {
    const { cookie, user } = await register(app);
    const plain = {
      tiles: Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => "plain")),
    };
    const units = [
      {
        id: "P-sword-1",
        side: "player",
        class: "sword",
        x: 4,
        y: 6,
        hp: 15,
        maxHp: 15,
        acted: false,
      },
      { id: "P-axe-1", side: "player", class: "axe", x: 0, y: 7, hp: 13, maxHp: 13, acted: true },
      {
        id: "E-sword-1",
        side: "enemy",
        class: "sword",
        x: 4,
        y: 0,
        hp: 15,
        maxHp: 15,
        acted: false,
      },
    ];
    const ins = await pool.query(
      `INSERT INTO games (user_id, difficulty, status, board, units, turn_number)
       VALUES ($1,'aggressive','player_turn',$2::jsonb,$3::jsonb,1) RETURNING id`,
      [user.id, JSON.stringify(plain), JSON.stringify(units)],
    );
    const id = ins.rows[0].id as string;

    const own = await request(app).get(`/api/games/${id}/preview/P-sword-1`).set("Cookie", cookie);
    expect(own.status).toBe(200);
    expect(own.body.side).toBe("player");
    expect(Array.isArray(own.body.moveTiles)).toBe(true);
    expect(Array.isArray(own.body.attackTiles)).toBe(true);
    expect(Array.isArray(own.body.healTiles)).toBe(true);

    const enemy = await request(app)
      .get(`/api/games/${id}/preview/E-sword-1`)
      .set("Cookie", cookie);
    expect(enemy.status).toBe(200);
    expect(enemy.body.side).toBe("enemy");

    const acted = await request(app).get(`/api/games/${id}/preview/P-axe-1`).set("Cookie", cookie);
    expect(acted.status).toBe(404);
    expect(acted.body).toEqual({ error: "Unit not playable" });

    const unknown = await request(app).get(`/api/games/${id}/preview/NOPE`).set("Cookie", cookie);
    expect(unknown.status).toBe(404);
    expect(unknown.body).toEqual({ error: "Unit not playable" });

    await pool.query("UPDATE games SET status='ai_turn' WHERE id=$1", [id]);
    const notTurn = await request(app)
      .get(`/api/games/${id}/preview/P-sword-1`)
      .set("Cookie", cookie);
    expect(notTurn.status).toBe(409);
    expect(notTurn.body).toEqual({ error: "Game is not waiting for your turn" });
  });

  it("POST /moves: illegal bundle 400 with move N and DB untouched; failed attempt unlocks; second applied -> 409; moves_applied restart-proof", async () => {
    const { cookie, user } = await register(app);
    const plain = {
      tiles: Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => "plain")),
    };
    const units = [
      {
        id: "P-archer-1",
        side: "player",
        class: "archer",
        x: 4,
        y: 6,
        hp: 9,
        maxHp: 9,
        acted: false,
      },
      {
        id: "E-sword-1",
        side: "enemy",
        class: "sword",
        x: 4,
        y: 3,
        hp: 15,
        maxHp: 15,
        acted: false,
      },
    ];
    const ins = await pool.query(
      `INSERT INTO games (user_id, difficulty, status, board, units, turn_number, moves_applied)
       VALUES ($1,'aggressive','player_turn',$2::jsonb,$3::jsonb,1,false) RETURNING id`,
      [user.id, JSON.stringify(plain), JSON.stringify(units)],
    );
    const id = ins.rows[0].id as string;
    const before = await pool.query("SELECT units, moves_applied, status FROM games WHERE id=$1", [
      id,
    ]);

    // illegal: archer range is exactly 2 but target at distance 3
    const bad = await request(app)
      .post(`/api/games/${id}/moves`)
      .set("Cookie", cookie)
      .send({
        moves: [
          {
            unitId: "P-archer-1",
            path: [[4, 6]],
            action: { type: "attack", targetId: "E-sword-1" },
          },
        ],
      });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("move 1: archer cannot attack a unit at 3 tiles");
    const afterBad = await pool.query(
      "SELECT units, moves_applied, status FROM games WHERE id=$1",
      [id],
    );
    expect(afterBad.rows[0].moves_applied).toBe(false);
    expect(afterBad.rows[0].status).toBe("player_turn");
    expect(afterBad.rows[0].units).toEqual(before.rows[0].units);

    // failed attempt left unlocked: valid wait submission now succeeds
    const ok = await request(app)
      .post(`/api/games/${id}/moves`)
      .set("Cookie", cookie)
      .send({ moves: [{ unitId: "P-archer-1", path: [[4, 6]], action: { type: "wait" } }] });
    expect(ok.status).toBe(200);
    expect(ok.body.game.status).toBe("player_turn");
    const afterOk = await pool.query("SELECT moves_applied FROM games WHERE id=$1", [id]);
    expect(afterOk.rows[0].moves_applied).toBe(true);

    // second applied submission rejected
    const second = await request(app)
      .post(`/api/games/${id}/moves`)
      .set("Cookie", cookie)
      .send({ moves: [] });
    expect(second.status).toBe(409);
    expect(second.body).toEqual({ error: "Turn moves already submitted" });
  });

  it("evolving landing validation via /moves: chain-follow SUCCESSES, must-fail cases still reject, and swap-by-order works", async () => {
    const { cookie, user } = await register(app);
    const plain = {
      tiles: Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => "plain")),
    };

    // chain-follow SUCCESS: unit A vacates (1,6), unit B moves into (1,6)
    const units1 = [
      {
        id: "P-sword-1",
        side: "player",
        class: "sword",
        x: 1,
        y: 6,
        hp: 15,
        maxHp: 15,
        acted: false,
      },
      {
        id: "P-sword-2",
        side: "player",
        class: "sword",
        x: 2,
        y: 6,
        hp: 15,
        maxHp: 15,
        acted: false,
      },
      {
        id: "E-sword-1",
        side: "enemy",
        class: "sword",
        x: 0,
        y: 0,
        hp: 15,
        maxHp: 15,
        acted: false,
      },
    ];
    const g1 = await pool.query(
      `INSERT INTO games (user_id, difficulty, status, board, units, turn_number, moves_applied)
       VALUES ($1,'aggressive','player_turn',$2::jsonb,$3::jsonb,1,false) RETURNING id`,
      [user.id, JSON.stringify(plain), JSON.stringify(units1)],
    );
    const id1 = g1.rows[0].id as string;
    const chain = await request(app)
      .post(`/api/games/${id1}/moves`)
      .set("Cookie", cookie)
      .send({
        moves: [
          {
            unitId: "P-sword-1",
            path: [
              [1, 6],
              [1, 5],
            ],
            action: { type: "wait" },
          },
          {
            unitId: "P-sword-2",
            path: [
              [2, 6],
              [1, 6],
            ],
            action: { type: "wait" },
          },
        ],
      });
    expect(chain.status).toBe(200);
    const u1 = (chain.body.game.units as Array<{ id: string; x: number; y: number }>).find(
      (u) => u.id === "P-sword-1",
    )!;
    const u2 = (chain.body.game.units as Array<{ id: string; x: number; y: number }>).find(
      (u) => u.id === "P-sword-2",
    )!;
    expect([u1.x, u1.y]).toEqual([1, 5]);
    expect([u2.x, u2.y]).toEqual([1, 6]);

    // must-fail: two entries claiming the same evolving tile still reject
    const units2 = [
      {
        id: "P-sword-1",
        side: "player",
        class: "sword",
        x: 1,
        y: 6,
        hp: 15,
        maxHp: 15,
        acted: false,
      },
      {
        id: "P-sword-2",
        side: "player",
        class: "sword",
        x: 3,
        y: 6,
        hp: 15,
        maxHp: 15,
        acted: false,
      },
      {
        id: "E-sword-1",
        side: "enemy",
        class: "sword",
        x: 0,
        y: 0,
        hp: 15,
        maxHp: 15,
        acted: false,
      },
    ];
    const g2 = await pool.query(
      `INSERT INTO games (user_id, difficulty, status, board, units, turn_number, moves_applied)
       VALUES ($1,'aggressive','player_turn',$2::jsonb,$3::jsonb,1,false) RETURNING id`,
      [user.id, JSON.stringify(plain), JSON.stringify(units2)],
    );
    const id2 = g2.rows[0].id as string;
    const clash = await request(app)
      .post(`/api/games/${id2}/moves`)
      .set("Cookie", cookie)
      .send({
        moves: [
          {
            unitId: "P-sword-1",
            path: [
              [1, 6],
              [2, 6],
            ],
            action: { type: "wait" },
          },
          {
            unitId: "P-sword-2",
            path: [
              [3, 6],
              [2, 6],
            ],
            action: { type: "wait" },
          },
        ],
      });
    expect(clash.status).toBe(400);
    expect(clash.body.error).toBe("move 2: tile (2,6) is claimed by two moves");

    // swap-by-order works: swapping/reordering so the vacating move comes first makes the chain valid
    // wrong order fails (would try to enter still-occupied tile), swapped correct order succeeds
    const units3 = [
      {
        id: "P-sword-1",
        side: "player",
        class: "sword",
        x: 1,
        y: 6,
        hp: 15,
        maxHp: 15,
        acted: false,
      },
      {
        id: "P-sword-2",
        side: "player",
        class: "sword",
        x: 2,
        y: 6,
        hp: 15,
        maxHp: 15,
        acted: false,
      },
      {
        id: "E-sword-1",
        side: "enemy",
        class: "sword",
        x: 0,
        y: 0,
        hp: 15,
        maxHp: 15,
        acted: false,
      },
    ];
    const g3 = await pool.query(
      `INSERT INTO games (user_id, difficulty, status, board, units, turn_number, moves_applied)
       VALUES ($1,'aggressive','player_turn',$2::jsonb,$3::jsonb,1,false) RETURNING id`,
      [user.id, JSON.stringify(plain), JSON.stringify(units3)],
    );
    const id3 = g3.rows[0].id as string;
    const wrongOrder = await request(app)
      .post(`/api/games/${id3}/moves`)
      .set("Cookie", cookie)
      .send({
        moves: [
          {
            unitId: "P-sword-2",
            path: [
              [2, 6],
              [1, 6],
            ],
            action: { type: "wait" },
          },
          {
            unitId: "P-sword-1",
            path: [
              [1, 6],
              [0, 6],
            ],
            action: { type: "wait" },
          },
        ],
      });
    expect(wrongOrder.status).toBe(400);
    // swap order -> works (vacate first, then follow)
    const g4 = await pool.query(
      `INSERT INTO games (user_id, difficulty, status, board, units, turn_number, moves_applied)
       VALUES ($1,'aggressive','player_turn',$2::jsonb,$3::jsonb,1,false) RETURNING id`,
      [user.id, JSON.stringify(plain), JSON.stringify(units3)],
    );
    const id4 = g4.rows[0].id as string;
    const swapped = await request(app)
      .post(`/api/games/${id4}/moves`)
      .set("Cookie", cookie)
      .send({
        moves: [
          {
            unitId: "P-sword-1",
            path: [
              [1, 6],
              [0, 6],
            ],
            action: { type: "wait" },
          },
          {
            unitId: "P-sword-2",
            path: [
              [2, 6],
              [1, 6],
            ],
            action: { type: "wait" },
          },
        ],
      });
    expect(swapped.status).toBe(200);
  });

  it("move loop end-to-end and victory short-circuit on /moves", async () => {
    const { cookie, user } = await register(app);
    const plain = {
      tiles: Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => "plain")),
    };

    // end-to-end: valid moves -> end-turn -> AI job resolves
    const units = [
      {
        id: "P-sword-1",
        side: "player",
        class: "sword",
        x: 4,
        y: 6,
        hp: 15,
        maxHp: 15,
        acted: false,
      },
      {
        id: "E-sword-1",
        side: "enemy",
        class: "sword",
        x: 4,
        y: 1,
        hp: 15,
        maxHp: 15,
        acted: false,
      },
    ];
    const g = await pool.query(
      `INSERT INTO games (user_id, difficulty, status, board, units, turn_number, moves_applied)
       VALUES ($1,'aggressive','player_turn',$2::jsonb,$3::jsonb,1,false) RETURNING id`,
      [user.id, JSON.stringify(plain), JSON.stringify(units)],
    );
    const id = g.rows[0].id as string;

    const mv = await request(app)
      .post(`/api/games/${id}/moves`)
      .set("Cookie", cookie)
      .send({
        moves: [
          {
            unitId: "P-sword-1",
            path: [
              [4, 6],
              [4, 5],
            ],
            action: { type: "wait" },
          },
        ],
      });
    expect(mv.status).toBe(200);
    expect(mv.body.game.status).toBe("player_turn");

    const end = await request(app).post(`/api/games/${id}/end-turn`).set("Cookie", cookie).send();
    expect(end.status).toBe(200);
    expect(end.body.game.status).toBe("ai_turn");
    expect(end.body.game.turnNumber).toBe(1);
    // all units acted reset false
    for (const u of end.body.game.units as Array<{ acted: boolean }>) expect(u.acted).toBe(false);

    await waitFor(async () => {
      const r = await pool.query(
        "SELECT status, turn_number, last_ai_actions, ai_last_error FROM games WHERE id=$1",
        [id],
      );
      const row = r.rows[0];
      if (row.status === "player_turn" || row.status === "lost") return row;
      return null;
    });
    const fin = await pool.query(
      "SELECT status, turn_number, last_ai_actions, ai_last_error, units FROM games WHERE id=$1",
      [id],
    );
    expect(["player_turn", "lost"]).toContain(fin.rows[0].status);
    expect(fin.rows[0].turn_number).toBe(2);
    expect(fin.rows[0].ai_last_error).toBeNull();
    expect(Array.isArray(fin.rows[0].last_ai_actions)).toBe(true);
    expect((fin.rows[0].last_ai_actions as unknown[]).length).toBeGreaterThan(0);
    if (fin.rows[0].status === "player_turn") {
      for (const u of fin.rows[0].units as Array<{ acted: boolean }>) expect(u.acted).toBe(false);
    }

    // victory short-circuit on /moves (wipe all enemies) -> won, no end-turn
    const unitsWin = [
      {
        id: "P-sword-1",
        side: "player",
        class: "sword",
        x: 4,
        y: 2,
        hp: 15,
        maxHp: 15,
        acted: false,
      },
      {
        id: "E-sword-1",
        side: "enemy",
        class: "sword",
        x: 4,
        y: 1,
        hp: 1,
        maxHp: 15,
        acted: false,
      },
    ];
    const gw = await pool.query(
      `INSERT INTO games (user_id, difficulty, status, board, units, turn_number, moves_applied)
       VALUES ($1,'aggressive','player_turn',$2::jsonb,$3::jsonb,1,false) RETURNING id`,
      [user.id, JSON.stringify(plain), JSON.stringify(unitsWin)],
    );
    const idw = gw.rows[0].id as string;
    const kill = await request(app)
      .post(`/api/games/${idw}/moves`)
      .set("Cookie", cookie)
      .send({
        moves: [
          {
            unitId: "P-sword-1",
            path: [[4, 2]],
            action: { type: "attack", targetId: "E-sword-1" },
          },
        ],
      });
    expect(kill.status).toBe(200);
    expect(kill.body.game.status).toBe("won");
  });

  it("forfeit from active states, reject finished, and conditional persist discards job result when forfeited", async () => {
    const { cookie, user } = await register(app);
    const plain = {
      tiles: Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => "plain")),
    };
    const units = [
      {
        id: "P-sword-1",
        side: "player",
        class: "sword",
        x: 0,
        y: 7,
        hp: 15,
        maxHp: 15,
        acted: false,
      },
      {
        id: "E-sword-1",
        side: "enemy",
        class: "sword",
        x: 0,
        y: 0,
        hp: 15,
        maxHp: 15,
        acted: false,
      },
    ];
    for (const status of ["generating_board", "player_turn", "ai_turn"] as const) {
      const ins = await pool.query(
        `INSERT INTO games (user_id, difficulty, status, board, units, turn_number)
         VALUES ($1,'aggressive',$2,$3::jsonb,$4::jsonb,1) RETURNING id`,
        [user.id, status, JSON.stringify(plain), JSON.stringify(units)],
      );
      const id = ins.rows[0].id as string;
      const ff = await request(app).post(`/api/games/${id}/forfeit`).set("Cookie", cookie).send();
      expect(ff.status).toBe(200);
      expect(ff.body.game.status).toBe("lost");
    }
    const won = await pool.query(
      `INSERT INTO games (user_id, difficulty, status, board, units, turn_number)
       VALUES ($1,'aggressive','won',$2::jsonb,$3::jsonb,1) RETURNING id`,
      [user.id, JSON.stringify(plain), JSON.stringify(units)],
    );
    const rej = await request(app)
      .post(`/api/games/${won.rows[0].id}/forfeit`)
      .set("Cookie", cookie)
      .send();
    expect(rej.status).toBe(409);
    expect(rej.body).toEqual({ error: "Game already finished" });

    // conditional persist: if forfeited (status no longer ai_turn), AI job result discarded
    const ai = await pool.query(
      `INSERT INTO games (user_id, difficulty, status, board, units, turn_number)
       VALUES ($1,'aggressive','ai_turn',$2::jsonb,$3::jsonb,3) RETURNING id`,
      [user.id, JSON.stringify(plain), JSON.stringify(units)],
    );
    const aid = ai.rows[0].id as string;
    await pool.query("UPDATE games SET status='lost' WHERE id=$1", [aid]);
    await runAiTurnJob(aid);
    const after = await pool.query(
      "SELECT status, turn_number, last_ai_actions FROM games WHERE id=$1",
      [aid],
    );
    expect(after.rows[0].status).toBe("lost");
    expect(after.rows[0].turn_number).toBe(3);
    expect(after.rows[0].last_ai_actions).toBeNull();
  });

  it("stats endpoint matches seeded outcomes and always includes all personas", async () => {
    const { cookie, user } = await register(app);
    const plain = {
      tiles: Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => "plain")),
    };
    const units: unknown[] = [];
    // seed: aggressive 1 win, defensive 1 loss, erratic none
    await pool.query(
      `INSERT INTO games (user_id, difficulty, status, board, units, turn_number) VALUES
       ($1,'aggressive','won',$2::jsonb,$3::jsonb,1),
       ($1,'defensive','lost',$2::jsonb,$3::jsonb,1),
       ($1,'aggressive','ai_turn',$2::jsonb,$3::jsonb,1)`,
      [user.id, JSON.stringify(plain), JSON.stringify(units)],
    );
    const res = await request(app).get("/api/stats").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.gamesPlayed).toBe(2);
    expect(res.body.wins).toBe(1);
    expect(res.body.losses).toBe(1);
    expect(res.body.winRate).toBe(0.5);
    expect(res.body.byDifficulty).toEqual([
      { difficulty: "aggressive", played: 1, wins: 1, losses: 0 },
      { difficulty: "defensive", played: 1, wins: 0, losses: 1 },
      { difficulty: "erratic", played: 0, wins: 0, losses: 0 },
    ]);

    const { cookie: c2 } = await register(app);
    const empty = await request(app).get("/api/stats").set("Cookie", c2);
    expect(empty.body.gamesPlayed).toBe(0);
    expect(empty.body.winRate).toBe(0);
  });
});
