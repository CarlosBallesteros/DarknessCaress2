import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ensureTestEnv } from "../../test/env.js";
import { resetUsers, setupDbApp } from "../../test/helpers.js";

ensureTestEnv();

function sessionCookie(res: request.Response): string {
  const raw = res.headers["set-cookie"];
  const cookies = !raw ? [] : Array.isArray(raw) ? raw : [raw];
  const found = cookies.find((c) => c.startsWith("dc_session="));
  if (!found) throw new Error("dc_session cookie not set");
  return found.split(";")[0];
}

function setCookieHeader(res: request.Response): string[] {
  const raw = res.headers["set-cookie"];
  return !raw ? [] : Array.isArray(raw) ? raw : [raw];
}

describe("phase 2 endpoint contract", () => {
  let app: Awaited<ReturnType<typeof setupDbApp>>;

  beforeAll(async () => {
    app = await setupDbApp();
  });

  beforeEach(async () => {
    await resetUsers();
  });

  it("register→login→me→patch username→password change→logout round trip and statuses", async () => {
    const reg = await request(app).post("/api/auth/register").send({
      email: "carlos@example.com",
      password: "correct-horse",
      username: "Carlos",
    });
    expect(reg.status).toBe(201);
    expect(reg.body.user).toMatchObject({
      email: "carlos@example.com",
      username: "Carlos",
      theme: "warriors-europe",
    });
    expect(reg.body.user.id).toBeTruthy();
    expect(reg.body.user.createdAt).toBeTruthy();
    const regCookie = sessionCookie(reg);
    expect(regCookie.startsWith("dc_session=")).toBe(true);

    const logout1 = await request(app).post("/api/auth/logout").set("Cookie", regCookie);
    expect(logout1.status).toBe(204);
    const cleared = setCookieHeader(logout1).join("; ");
    expect(cleared).toContain("dc_session=");

    const login = await request(app).post("/api/auth/login").send({
      email: "carlos@example.com",
      password: "correct-horse",
    });
    expect(login.status).toBe(200);
    expect(login.body.user.username).toBe("Carlos");
    const session = sessionCookie(login);

    const me = await request(app).get("/api/me").set("Cookie", session);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe("carlos@example.com");

    const patchUser = await request(app)
      .patch("/api/me")
      .set("Cookie", session)
      .send({ username: "NewName" });
    expect(patchUser.status).toBe(200);
    expect(patchUser.body.user.username).toBe("NewName");

    const pw = await request(app)
      .patch("/api/me/password")
      .set("Cookie", session)
      .send({ currentPassword: "correct-horse", newPassword: "better-horse" });
    expect(pw.status).toBe(204);

    const oldLogin = await request(app).post("/api/auth/login").send({
      email: "carlos@example.com",
      password: "correct-horse",
    });
    expect(oldLogin.status).toBe(401);
    expect(oldLogin.body).toEqual({ error: "Invalid email or password" });

    const newLogin = await request(app).post("/api/auth/login").send({
      email: "carlos@example.com",
      password: "better-horse",
    });
    expect(newLogin.status).toBe(200);
    expect(newLogin.body.user.username).toBe("NewName");

    const logout2 = await request(app).post("/api/auth/logout");
    expect(logout2.status).toBe(204);
  });

  it("returns contract 400/401/409 statuses and messages", async () => {
    const badReg = await request(app).post("/api/auth/register").send({
      email: "not-an-email",
      password: "short",
      username: "ab",
    });
    expect(badReg.status).toBe(400);
    expect(typeof badReg.body.error).toBe("string");

    await request(app).post("/api/auth/register").send({
      email: "taken@example.com",
      password: "correct-horse",
      username: "TakenName",
    });
    await request(app).post("/api/auth/register").send({
      email: "other@example.com",
      password: "correct-horse",
      username: "OtherName",
    });

    const dupEmail = await request(app).post("/api/auth/register").send({
      email: "taken@example.com",
      password: "correct-horse",
      username: "FreshName",
    });
    expect(dupEmail.status).toBe(409);
    expect(dupEmail.body).toEqual({ error: "Email already registered" });

    const dupUsername = await request(app).post("/api/auth/register").send({
      email: "fresh@example.com",
      password: "correct-horse",
      username: "TakenName",
    });
    expect(dupUsername.status).toBe(409);
    expect(dupUsername.body).toEqual({ error: "Username already taken" });

    const badLogin = await request(app).post("/api/auth/login").send({ email: "x", password: "" });
    expect(badLogin.status).toBe(400);
    expect(typeof badLogin.body.error).toBe("string");

    const wrongPw = await request(app).post("/api/auth/login").send({
      email: "taken@example.com",
      password: "wrong-password",
    });
    expect(wrongPw.status).toBe(401);
    expect(wrongPw.body).toEqual({ error: "Invalid email or password" });
    const unknown = await request(app).post("/api/auth/login").send({
      email: "nobody@example.com",
      password: "whatever-pass",
    });
    expect(unknown.status).toBe(401);
    expect(unknown.body).toEqual({ error: "Invalid email or password" });

    const meNoAuth = await request(app).get("/api/me");
    expect(meNoAuth.status).toBe(401);
    expect(meNoAuth.body).toEqual({ error: "Not authenticated" });
    const patchNoAuth = await request(app).patch("/api/me").send({ username: "X" });
    expect(patchNoAuth.status).toBe(401);
    expect(patchNoAuth.body).toEqual({ error: "Not authenticated" });
    const pwNoAuth = await request(app)
      .patch("/api/me/password")
      .send({ currentPassword: "a", newPassword: "bbbbbbbb" });
    expect(pwNoAuth.status).toBe(401);
    expect(pwNoAuth.body).toEqual({ error: "Not authenticated" });

    const loginOk = await request(app).post("/api/auth/login").send({
      email: "taken@example.com",
      password: "correct-horse",
    });
    const session = sessionCookie(loginOk);

    const patchEmpty = await request(app).patch("/api/me").set("Cookie", session).send({});
    expect(patchEmpty.status).toBe(400);
    expect(typeof patchEmpty.body.error).toBe("string");

    const patchBadTheme = await request(app)
      .patch("/api/me")
      .set("Cookie", session)
      .send({ theme: "nope" });
    expect(patchBadTheme.status).toBe(400);
    expect(patchBadTheme.body).toEqual({ error: "Unknown theme" });

    const patchDup = await request(app)
      .patch("/api/me")
      .set("Cookie", session)
      .send({ username: "OtherName" });
    expect(patchDup.status).toBe(409);
    expect(patchDup.body).toEqual({ error: "Username already taken" });

    const badNew = await request(app)
      .patch("/api/me/password")
      .set("Cookie", session)
      .send({ currentPassword: "correct-horse", newPassword: "short" });
    expect(badNew.status).toBe(400);
    expect(typeof badNew.body.error).toBe("string");

    const wrongCurrent = await request(app)
      .patch("/api/me/password")
      .set("Cookie", session)
      .send({ currentPassword: "nope-nope", newPassword: "long-enough" });
    expect(wrongCurrent.status).toBe(401);
    expect(wrongCurrent.body).toEqual({ error: "Current password is incorrect" });
  });

  it("GET /api/meta returns public subset per contract", async () => {
    const res = await request(app).get("/api/meta");
    expect(res.status).toBe(200);
    expect(res.body.boardSize).toBe(8);
    expect(res.body.maxActiveGames).toBe(5);
    expect(Object.keys(res.body.classes).sort()).toEqual([
      "archer",
      "axe",
      "healer",
      "mage",
      "spear",
      "sword",
    ]);
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
    expect(res.body.personalities).toEqual({
      aggressive: { label: "Aggressive" },
      defensive: { label: "Cowardly" },
      erratic: { label: "Crazy" },
    });
    expect(res.body.themes).toEqual([{ id: "warriors-europe", label: "Champions of Europe" }]);
    expect(res.body.lore).toHaveProperty("sword");
    expect(res.body.lore).toHaveProperty("healer");
  });
});

describe("login rate limit", () => {
  it("fires 429 on 11th rapid login attempt", async () => {
    const app = await setupDbApp();
    await resetUsers();
    await request(app).post("/api/auth/register").send({
      email: "rate@example.com",
      password: "correct-horse",
      username: "RateUser",
    });

    for (let i = 0; i < 10; i++) {
      const res = await request(app).post("/api/auth/login").send({
        email: "rate@example.com",
        password: "wrong-password",
      });
      expect(res.status).toBe(401);
    }

    const eleventh = await request(app).post("/api/auth/login").send({
      email: "rate@example.com",
      password: "wrong-password",
    });
    expect(eleventh.status).toBe(429);
  });
});
