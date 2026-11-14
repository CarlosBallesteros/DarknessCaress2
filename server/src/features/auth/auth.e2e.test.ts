import { readFileSync } from "node:fs";
import path from "node:path";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.DATABASE_URL ??= "postgres://dc:dc@127.0.0.1:5432/darknesscaress";
process.env.JWT_SECRET ??= "test-secret";
process.env.OLLAMA_URL ??= "http://localhost:11434";
process.env.OLLAMA_MODEL ??= "qwen2.5:7b-instruct-q4_K_M";
process.env.PORT ??= "3000";
process.env.NODE_ENV ??= "test";

function unique(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function cookieHeader(res: request.Response): string {
  const raw = res.headers["set-cookie"];
  if (!raw) return "";
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr.map((c) => c.split(";")[0]).join("; ");
}

describe("auth and meta endpoints", async () => {
  const { app } = await import("../../app");
  const { pool } = await import("../../db/pool");

  beforeAll(async () => {
    const schemaPath = path.resolve(__dirname, "../../db/schema.sql");
    const sql = readFileSync(schemaPath, "utf8");
    await pool.query(sql);
  });

  afterAll(async () => {
    // Pool is shared across tests in-process; do not end it here.
  });

  it("GET /api/meta returns public subset", async () => {
    const res = await request(app).get("/api/meta");
    expect(res.status).toBe(200);
    expect(res.body.boardSize).toBe(8);
    expect(res.body.maxActiveGames).toBe(5);
    expect(res.body.classes.sword).toMatchObject({
      label: "Swordsman",
      hp: 15,
      atk: 8,
      def: 3,
      mov: 3,
      range: [1],
      role: "attacker",
      count: 2,
    });
    expect(res.body.classes.healer).toMatchObject({
      label: "Healer",
      hp: 10,
      atk: 0,
      def: 1,
      mov: 2,
      range: [],
      role: "supporter",
      count: 1,
      healAmount: 6,
    });
    expect(Object.keys(res.body.classes)).toHaveLength(6);
    expect(res.body.personalities).toEqual({
      aggressive: { label: "Aggressive" },
      defensive: { label: "Cowardly" },
      erratic: { label: "Crazy" },
    });
    expect(res.body.themes).toEqual([{ id: "warriors-europe", label: "Champions of Europe" }]);
    expect(res.body.lore).toHaveProperty("sword");
    expect(res.body).not.toHaveProperty("ai");
  });

  it("register→login→me→patch username→password change→logout round trip", async () => {
    const email = `${unique("user")}@example.com`;
    const username = unique("u").slice(0, 18);
    const password = "correct-horse";

    const register = await request(app).post("/api/auth/register").send({
      email,
      password,
      username,
    });
    expect(register.status).toBe(201);
    expect(register.body.user).toMatchObject({ email, username });
    expect(register.body.user.theme).toBe("warriors-europe");
    expect(register.body.user).toHaveProperty("id");
    expect(register.body.user).toHaveProperty("createdAt");
    expect(register.body.user).not.toHaveProperty("password_hash");
    expect(register.body.user).not.toHaveProperty("passwordHash");
    const regCookie = cookieHeader(register);
    expect(regCookie).toContain("dc_session=");

    const login = await request(app).post("/api/auth/login").send({
      email,
      password,
    });
    expect(login.status).toBe(200);
    expect(login.body.user).toMatchObject({ email, username });
    const loginCookie = cookieHeader(login);
    expect(loginCookie).toContain("dc_session=");

    const me = await request(app).get("/api/me").set("Cookie", loginCookie);
    expect(me.status).toBe(200);
    expect(me.body.user).toMatchObject({ email, username });

    const newUsername = unique("n").slice(0, 18);
    const patch = await request(app)
      .patch("/api/me")
      .set("Cookie", loginCookie)
      .send({ username: newUsername });
    expect(patch.status).toBe(200);
    expect(patch.body.user.username).toBe(newUsername);

    const pwd = await request(app)
      .patch("/api/me/password")
      .set("Cookie", loginCookie)
      .send({ currentPassword: password, newPassword: "new-password-8" });
    expect(pwd.status).toBe(204);

    const loginOld = await request(app).post("/api/auth/login").send({
      email,
      password,
    });
    expect(loginOld.status).toBe(401);
    expect(loginOld.body).toEqual({ error: "Invalid email or password" });

    const loginNew = await request(app).post("/api/auth/login").send({
      email,
      password: "new-password-8",
    });
    expect(loginNew.status).toBe(200);
    const newCookie = cookieHeader(loginNew);

    const logout = await request(app).post("/api/auth/logout").set("Cookie", newCookie);
    expect(logout.status).toBe(204);

    const logoutAgain = await request(app).post("/api/auth/logout");
    expect(logoutAgain.status).toBe(204);

    const meAfter = await request(app).get("/api/me");
    expect(meAfter.status).toBe(401);
    expect(meAfter.body).toEqual({ error: "Not authenticated" });
  });

  it("register duplicate email returns 409", async () => {
    const email = `${unique("dup")}@example.com`;
    const base = {
      email,
      password: "correct-horse",
      username: unique("a").slice(0, 18),
    };
    const first = await request(app).post("/api/auth/register").send(base);
    expect(first.status).toBe(201);
    const second = await request(app)
      .post("/api/auth/register")
      .send({ ...base, username: unique("b").slice(0, 18) });
    expect(second.status).toBe(409);
    expect(second.body).toEqual({ error: "Email already registered" });
  });

  it("register duplicate username returns 409", async () => {
    const username = unique("du").slice(0, 18);
    const first = await request(app)
      .post("/api/auth/register")
      .send({
        email: `${unique("x")}@example.com`,
        password: "correct-horse",
        username,
      });
    expect(first.status).toBe(201);
    const second = await request(app)
      .post("/api/auth/register")
      .send({
        email: `${unique("y")}@example.com`,
        password: "correct-horse",
        username,
      });
    expect(second.status).toBe(409);
    expect(second.body).toEqual({ error: "Username already taken" });
  });

  it("login wrong password returns 401 same message as unknown email", async () => {
    const email = `${unique("wp")}@example.com`;
    await request(app)
      .post("/api/auth/register")
      .send({
        email,
        password: "correct-horse",
        username: unique("w").slice(0, 18),
      });
    const wrong = await request(app).post("/api/auth/login").send({
      email,
      password: "bad-password",
    });
    const unknown = await request(app)
      .post("/api/auth/login")
      .send({
        email: `missing_${unique("m")}@example.com`,
        password: "bad-password",
      });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual({ error: "Invalid email or password" });
    expect(unknown.body).toEqual({ error: "Invalid email or password" });
  });

  it("returns 400 statuses per contract for invalid inputs", async () => {
    const badRegister = await request(app)
      .post("/api/auth/register")
      .send({ email: "not-an-email", password: "short", username: "x" });
    expect(badRegister.status).toBe(400);
    expect(badRegister.body).toHaveProperty("error");

    const badLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: "nope", password: "" });
    expect(badLogin.status).toBe(400);
    expect(badLogin.body).toHaveProperty("error");

    const email = `${unique("v")}@example.com`;
    const reg = await request(app)
      .post("/api/auth/register")
      .send({
        email,
        password: "correct-horse",
        username: unique("v").slice(0, 18),
      });
    const cookie = cookieHeader(reg);

    const badPatchEmpty = await request(app).patch("/api/me").set("Cookie", cookie).send({});
    expect(badPatchEmpty.status).toBe(400);
    expect(badPatchEmpty.body).toHaveProperty("error");

    const badTheme = await request(app)
      .patch("/api/me")
      .set("Cookie", cookie)
      .send({ theme: "nope-theme" });
    expect(badTheme.status).toBe(400);
    expect(badTheme.body).toEqual({ error: "Unknown theme" });

    const badPwd = await request(app)
      .patch("/api/me/password")
      .set("Cookie", cookie)
      .send({ currentPassword: "x", newPassword: "short" });
    expect(badPwd.status).toBe(400);
    expect(badPwd.body).toHaveProperty("error");

    const wrongCurrent = await request(app)
      .patch("/api/me/password")
      .set("Cookie", cookie)
      .send({ currentPassword: "wrong-current", newPassword: "new-password-8" });
    expect(wrongCurrent.status).toBe(401);
    expect(wrongCurrent.body).toEqual({ error: "Current password is incorrect" });

    const dupUser = unique("t").slice(0, 18);
    await request(app)
      .post("/api/auth/register")
      .send({
        email: `${unique("t2")}@example.com`,
        password: "correct-horse",
        username: dupUser,
      });
    const taken = await request(app)
      .patch("/api/me")
      .set("Cookie", cookie)
      .send({ username: dupUser });
    expect(taken.status).toBe(409);
    expect(taken.body).toEqual({ error: "Username already taken" });
  });

  it("rate limit fires 429 on 11th rapid login attempt", async () => {
    const { createAuthRouter } = await import("./routes");
    const { createLoginRateLimit } = await import("./loginRateLimit");
    const { metaRouter } = await import("../meta/routes");
    const { usersRouter } = await import("../users/routes");
    const { wrapAsync } = await import("../wrapAsync");

    const testApp = express();
    testApp.set("trust proxy", 1);
    testApp.use(express.json());
    testApp.use(cookieParser());
    testApp.get(
      "/api/health",
      wrapAsync(async (_req, res) => {
        res.status(200).json({ ok: true });
      }),
    );
    testApp.use(createAuthRouter({ loginLimiter: createLoginRateLimit() }));
    testApp.use(usersRouter);
    testApp.use(metaRouter);

    let lastStatus = 0;
    for (let i = 0; i < 11; i++) {
      const res = await request(testApp).post("/api/auth/login").send({
        email: "nobody@example.com",
        password: "wrong-password",
      });
      lastStatus = res.status;
      if (i < 10) {
        expect(res.status).toBe(401);
      }
    }
    expect(lastStatus).toBe(429);
  });
});
