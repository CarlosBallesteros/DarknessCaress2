import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createServer } from "../../app";
import { migrate } from "../../db/migrate";
import { resetDb } from "../../test/db";
import { loginLimiter } from "./router";

function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
}

function uniqueUsername(prefix: string) {
  return `${prefix}_${Math.random().toString(16).slice(2, 8)}`;
}

// supertest types `headers` as a plain string map, but "set-cookie" is an
// array at runtime — normalize to the single Cookie header string superagent
// expects in .set("Cookie", ...).
function cookieHeader(res: { headers: Record<string, unknown> }): string {
  const value = res.headers["set-cookie"];
  return Array.isArray(value) ? value.join("; ") : String(value ?? "");
}

describe("auth and user endpoints (phase 2)", () => {
  const app = createServer();

  beforeAll(async () => {
    await migrate();
  });

  beforeEach(async () => {
    await resetDb();
    loginLimiter.resetKey("::ffff:127.0.0.1");
    loginLimiter.resetKey("127.0.0.1");
  });

  it("registers, logs in, gets me, patches username, changes password, and logs out", async () => {
    const email = uniqueEmail("carlos");
    const username = uniqueUsername("Carlos");
    const password = "correct-horse";

    const registerRes = await request(app).post("/api/auth/register").send({
      email,
      password,
      username,
    });
    expect(registerRes.status).toBe(201);
    expect(registerRes.body.user).toMatchObject({
      email,
      username,
      theme: "warriors-europe",
    });
    expect(registerRes.body.user.id).toEqual(expect.any(String));
    expect(registerRes.body.user.createdAt).toEqual(expect.any(String));
    expect(cookieHeader(registerRes)).toContain("dc_session=");

    const registerCookie = cookieHeader(registerRes);

    const loginRes = await request(app).post("/api/auth/login").send({
      email,
      password,
    });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.user.email).toBe(email);
    expect(cookieHeader(loginRes)).toContain("dc_session=");
    const cookie = cookieHeader(loginRes);

    const meRes = await request(app).get("/api/me").set("Cookie", cookie);
    expect(meRes.status).toBe(200);
    expect(meRes.body.user.username).toBe(username);

    const newUsername = uniqueUsername("NewName");
    const patchRes = await request(app)
      .patch("/api/me")
      .set("Cookie", cookie)
      .send({ username: newUsername });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.user.username).toBe(newUsername);

    const passwordRes = await request(app)
      .patch("/api/me/password")
      .set("Cookie", cookie)
      .send({ currentPassword: password, newPassword: "new-password-123" });
    expect(passwordRes.status).toBe(204);

    // Old password no longer works.
    loginLimiter.resetKey("::ffff:127.0.0.1");
    loginLimiter.resetKey("127.0.0.1");
    const oldLogin = await request(app).post("/api/auth/login").send({
      email,
      password,
    });
    expect(oldLogin.status).toBe(401);
    expect(oldLogin.body).toEqual({ error: "Invalid email or password" });

    loginLimiter.resetKey("::ffff:127.0.0.1");
    loginLimiter.resetKey("127.0.0.1");
    const newLogin = await request(app).post("/api/auth/login").send({
      email,
      password: "new-password-123",
    });
    expect(newLogin.status).toBe(200);

    const logoutRes = await request(app).post("/api/auth/logout").set("Cookie", registerCookie);
    expect(logoutRes.status).toBe(204);

    const logoutAgain = await request(app).post("/api/auth/logout");
    expect(logoutAgain.status).toBe(204);
  });

  it("returns 409 when email is already registered", async () => {
    const email = uniqueEmail("dup");
    const payload = {
      email,
      password: "correct-horse",
      username: uniqueUsername("user"),
    };
    const first = await request(app).post("/api/auth/register").send(payload);
    expect(first.status).toBe(201);

    const second = await request(app)
      .post("/api/auth/register")
      .send({ ...payload, username: uniqueUsername("other") });
    expect(second.status).toBe(409);
    expect(second.body).toEqual({ error: "Email already registered" });
  });

  it("returns 409 when username is already taken", async () => {
    const username = uniqueUsername("dupname");
    const first = await request(app)
      .post("/api/auth/register")
      .send({
        email: uniqueEmail("a"),
        password: "correct-horse",
        username,
      });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post("/api/auth/register")
      .send({
        email: uniqueEmail("b"),
        password: "correct-horse",
        username,
      });
    expect(second.status).toBe(409);
    expect(second.body).toEqual({ error: "Username already taken" });
  });

  it("returns 401 with same message for unknown email and wrong password", async () => {
    const email = uniqueEmail("known");
    await request(app)
      .post("/api/auth/register")
      .send({
        email,
        password: "correct-horse",
        username: uniqueUsername("known"),
      });

    loginLimiter.resetKey("::ffff:127.0.0.1");
    loginLimiter.resetKey("127.0.0.1");
    const unknown = await request(app)
      .post("/api/auth/login")
      .send({
        email: uniqueEmail("unknown"),
        password: "correct-horse",
      });
    expect(unknown.status).toBe(401);
    expect(unknown.body).toEqual({ error: "Invalid email or password" });

    loginLimiter.resetKey("::ffff:127.0.0.1");
    loginLimiter.resetKey("127.0.0.1");
    const wrong = await request(app).post("/api/auth/login").send({
      email,
      password: "wrong-password",
    });
    expect(wrong.status).toBe(401);
    expect(wrong.body).toEqual({ error: "Invalid email or password" });
  });

  it("validates request bodies and returns contract errors (400s)", async () => {
    const badRegister = await request(app).post("/api/auth/register").send({
      email: "not-an-email",
      password: "short",
      username: "ok",
    });
    expect(badRegister.status).toBe(400);
    expect(badRegister.body.error).toEqual(expect.any(String));

    const badLogin = await request(app).post("/api/auth/login").send({});
    expect(badLogin.status).toBe(400);
    expect(badLogin.body.error).toEqual(expect.any(String));

    const noAuthMe = await request(app).get("/api/me");
    expect(noAuthMe.status).toBe(401);
    expect(noAuthMe.body).toEqual({ error: "Not authenticated" });

    // Create user for authenticated 400 checks.
    const email = uniqueEmail("val");
    const reg = await request(app)
      .post("/api/auth/register")
      .send({
        email,
        password: "correct-horse",
        username: uniqueUsername("val"),
      });
    const cookie = cookieHeader(reg);

    const badPatch = await request(app).patch("/api/me").set("Cookie", cookie).send({});
    expect(badPatch.status).toBe(400);
    expect(badPatch.body.error).toEqual(expect.any(String));

    const unknownTheme = await request(app)
      .patch("/api/me")
      .set("Cookie", cookie)
      .send({ theme: "not-a-theme" });
    expect(unknownTheme.status).toBe(400);
    expect(unknownTheme.body).toEqual({ error: "Unknown theme" });

    const badPassword = await request(app)
      .patch("/api/me/password")
      .set("Cookie", cookie)
      .send({ currentPassword: "correct-horse", newPassword: "short" });
    expect(badPassword.status).toBe(400);
    expect(badPassword.body.error).toEqual(expect.any(String));

    const wrongCurrent = await request(app)
      .patch("/api/me/password")
      .set("Cookie", cookie)
      .send({ currentPassword: "nope-nope", newPassword: "new-password-123" });
    expect(wrongCurrent.status).toBe(401);
    expect(wrongCurrent.body).toEqual({ error: "Current password is incorrect" });
  });

  it("returns 409 when patching username to an existing one", async () => {
    const a = await request(app)
      .post("/api/auth/register")
      .send({
        email: uniqueEmail("a"),
        password: "correct-horse",
        username: uniqueUsername("alpha"),
      });
    const b = await request(app)
      .post("/api/auth/register")
      .send({
        email: uniqueEmail("b"),
        password: "correct-horse",
        username: uniqueUsername("beta"),
      });
    const taken = b.body.user.username as string;
    const res = await request(app)
      .patch("/api/me")
      .set("Cookie", cookieHeader(a))
      .send({ username: taken });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "Username already taken" });
  });

  it("returns public meta subset", async () => {
    const res = await request(app).get("/api/meta");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      boardSize: 8,
      maxActiveGames: 5,
      personalities: {
        aggressive: { label: "Aggressive" },
        defensive: { label: "Defensive" },
        erratic: { label: "Erratic" },
      },
      themes: [{ id: "warriors-europe", label: "Champions of Europe" }],
    });
    expect(Object.keys(res.body.classes)).toEqual(
      expect.arrayContaining(["sword", "axe", "spear", "archer", "mage", "healer"]),
    );
    expect(res.body.classes.healer).toMatchObject({ healAmount: 8, count: 1 });
    expect(res.body.classes.sword).not.toHaveProperty("temperature");
  });

  it("fires 429 on 11th rapid login attempt", async () => {
    loginLimiter.resetKey("::ffff:127.0.0.1");
    loginLimiter.resetKey("127.0.0.1");
    let lastStatus = 0;
    for (let i = 0; i < 11; i++) {
      const res = await request(app).post("/api/auth/login").send({
        email: "nobody@example.com",
        password: "wrong-password",
      });
      lastStatus = res.status;
      if (i < 10) {
        expect([400, 401]).toContain(res.status);
      }
    }
    expect(lastStatus).toBe(429);
  });
});
