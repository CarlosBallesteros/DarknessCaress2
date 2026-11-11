import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { createServer } from "../../app";
import { migrate } from "../../db/migrate";
import { pool } from "../../db/pool";
import { passwordChangeSchema, patchMeSchema, registerSchema } from "./schemas";

// Supertest suite per docs/09 phase 2: the full register→login→me→patch→
// password→logout round trip plus every contract status in between.
// Runs against the dev db (docs/01's compose override binds it to 127.0.0.1);
// rows are marked with the test email domain and deleted afterwards.
const app = createServer();
const EMAIL_DOMAIN = "dc2-test.example";
const suffix = crypto.randomUUID().slice(0, 8);

const email = `roundtrip-${suffix}@${EMAIL_DOMAIN}`;
const username = `user_${suffix}`;
const password = "correct-horse";
const newPassword = "better-horse-2";
let sessionCookie = "";

type Res = { headers: Record<string, unknown> };

function cookieOf(res: Res): string {
  const setCookie = res.headers["set-cookie"];
  const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (typeof first !== "string") {
    throw new Error("expected a Set-Cookie header");
  }
  return first.split(";")[0];
}

// The 400 body must be the FIRST zod issue (docs/06 conventions) — computed
// live from the schema so the test asserts the rule, not a frozen message.
function firstIssue(schema: ZodType<unknown>, body: unknown): string {
  const result = schema.safeParse(body);
  if (result.success) {
    throw new Error("expected the body to fail the schema");
  }
  return result.error.issues[0].message;
}

beforeAll(async () => {
  await migrate();
});

afterAll(async () => {
  await pool.query("DELETE FROM users WHERE email LIKE $1", [`%@${EMAIL_DOMAIN}`]);
  await pool.end();
});

describe("register (docs/06 endpoint 1)", () => {
  it("201 with the user DTO and a usable session cookie", async () => {
    const res = await request(app).post("/api/auth/register").send({ email, password, username });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({
      email,
      username,
      theme: "warriors-europe",
    });
    expect(typeof res.body.user.id).toBe("string");
    expect(typeof res.body.user.createdAt).toBe("string");
    sessionCookie = cookieOf(res);
    expect(sessionCookie).toMatch(/^dc_session=/);
    expect(res.headers["set-cookie"][0]).toContain("HttpOnly");
    expect(res.headers["set-cookie"][0]).toContain("SameSite=Lax");
    // register's cookie is already a valid session for GET /api/me
    const me = await request(app).get("/api/me").set("Cookie", sessionCookie);
    expect(me.status).toBe(200);
    expect(me.body.user.username).toBe(username);
  });

  it("409 Email already registered on a duplicate email", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email, password, username: `other_${suffix}` });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "Email already registered" });
  });

  it("409 Username already taken on a duplicate username (case-insensitive)", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: `dup-${suffix}@${EMAIL_DOMAIN}`, password, username: username.toUpperCase() });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "Username already taken" });
  });

  it("400 with the first zod issue on an invalid email", async () => {
    const body = { email: "not-an-email", password, username };
    const res = await request(app).post("/api/auth/register").send(body);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: firstIssue(registerSchema, body) });
  });

  it("400 with the first zod issue on a short password", async () => {
    const body = { email: `short-${suffix}@${EMAIL_DOMAIN}`, password: "short", username };
    const res = await request(app).post("/api/auth/register").send(body);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: firstIssue(registerSchema, body) });
  });

  it("400 with the first zod issue on a bad username", async () => {
    const body = { email: `bad-${suffix}@${EMAIL_DOMAIN}`, password, username: "bad name!" };
    const res = await request(app).post("/api/auth/register").send(body);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: firstIssue(registerSchema, body) });
  });
});

describe("login (docs/06 endpoint 2)", () => {
  it("200 with the user DTO and a fresh session cookie", async () => {
    const res = await request(app).post("/api/auth/login").send({ email, password });
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe(username);
    sessionCookie = cookieOf(res);
  });

  it("401 Invalid email or password for an unknown email", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: `ghost-${suffix}@${EMAIL_DOMAIN}`, password });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Invalid email or password" });
  });

  it("401 with the SAME message for a wrong password", async () => {
    const res = await request(app).post("/api/auth/login").send({ email, password: "wrong-pass" });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Invalid email or password" });
  });
});

describe("GET /api/me (docs/06 endpoint 4)", () => {
  it("401 Not authenticated with no cookie", async () => {
    const res = await request(app).get("/api/me");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Not authenticated" });
  });

  it("401 Not authenticated with a garbage cookie", async () => {
    const res = await request(app).get("/api/me").set("Cookie", "dc_session=garbage");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Not authenticated" });
  });

  it("200 with the current user", async () => {
    const res = await request(app).get("/api/me").set("Cookie", sessionCookie);
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email, username, theme: "warriors-europe" });
  });
});

describe("PATCH /api/me (docs/06 endpoint 5)", () => {
  it("400 when no key is present", async () => {
    const body = {};
    const res = await request(app).patch("/api/me").set("Cookie", sessionCookie).send(body);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: firstIssue(patchMeSchema, body) });
  });

  it("400 Unknown theme", async () => {
    const res = await request(app)
      .patch("/api/me")
      .set("Cookie", sessionCookie)
      .send({ theme: "nope" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Unknown theme" });
  });

  it("200 patches the username", async () => {
    const res = await request(app)
      .patch("/api/me")
      .set("Cookie", sessionCookie)
      .send({ username: `renamed_${suffix}` });
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe(`renamed_${suffix}`);
  });

  it("200 patches the theme", async () => {
    const res = await request(app)
      .patch("/api/me")
      .set("Cookie", sessionCookie)
      .send({ theme: "warriors-europe" });
    expect(res.status).toBe(200);
    expect(res.body.user.theme).toBe("warriors-europe");
  });

  it("409 Username already taken when renaming to another user's username", async () => {
    const second = await request(app)
      .post("/api/auth/register")
      .send({
        email: `second-${suffix}@${EMAIL_DOMAIN}`,
        password,
        username: `second_${suffix}`,
      });
    expect(second.status).toBe(201);
    const res = await request(app)
      .patch("/api/me")
      .set("Cookie", sessionCookie)
      .send({ username: `SECOND_${suffix}` });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "Username already taken" });
  });

  it("401 without auth", async () => {
    const res = await request(app).patch("/api/me").send({ username: "nope" });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Not authenticated" });
  });
});

describe("PATCH /api/me/password (docs/06 endpoint 6)", () => {
  it("401 Current password is incorrect", async () => {
    const res = await request(app)
      .patch("/api/me/password")
      .set("Cookie", sessionCookie)
      .send({ currentPassword: "wrong-pass", newPassword });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Current password is incorrect" });
  });

  it("400 with the first zod issue on a missing/short field", async () => {
    const body = { currentPassword: password, newPassword: "short" };
    const res = await request(app)
      .patch("/api/me/password")
      .set("Cookie", sessionCookie)
      .send(body);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: firstIssue(passwordChangeSchema, body) });
  });

  it("401 without auth", async () => {
    const res = await request(app)
      .patch("/api/me/password")
      .send({ currentPassword: password, newPassword });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Not authenticated" });
  });

  it("204 on success; the session stays valid; old password dies, new one logs in", async () => {
    const res = await request(app)
      .patch("/api/me/password")
      .set("Cookie", sessionCookie)
      .send({ currentPassword: password, newPassword });
    expect(res.status).toBe(204);
    // Other sessions stay valid (no revocation machinery in MVP, docs/06).
    const me = await request(app).get("/api/me").set("Cookie", sessionCookie);
    expect(me.status).toBe(200);
    const oldLogin = await request(app).post("/api/auth/login").send({ email, password });
    expect(oldLogin.status).toBe(401);
    expect(oldLogin.body).toEqual({ error: "Invalid email or password" });
    const newLogin = await request(app)
      .post("/api/auth/login")
      .send({ email, password: newPassword });
    expect(newLogin.status).toBe(200);
    sessionCookie = cookieOf(newLogin);
  });
});

describe("logout (docs/06 endpoint 3)", () => {
  it("204 and the cookie is cleared", async () => {
    const res = await request(app).post("/api/auth/logout").set("Cookie", sessionCookie);
    expect(res.status).toBe(204);
    const setCookie = res.headers["set-cookie"];
    expect(String(setCookie)).toMatch(/dc_session=;/);
    expect(String(setCookie)).toMatch(/Expires=Thu, 01 Jan 1970/);
  });

  it("204 even with no session at all", async () => {
    const res = await request(app).post("/api/auth/logout");
    expect(res.status).toBe(204);
  });

  it("a dropped cookie is 401 again (no server-side session left behind)", async () => {
    const res = await request(app).get("/api/me").set("Cookie", "dc_session=");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Not authenticated" });
  });
});
