// Endpoint tests for auth (docs/06 endpoints 1–3, docs/09 phase 2): statuses,
// bodies, cookies, rate limiting, requireAuth behavior. Runs against the real
// (loopback) database — every test generates fresh unique credentials.
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../app";
import { pool } from "../../db/pool";

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

describe("POST /api/auth/register", () => {
  it("creates the account: 201, User DTO, session cookie", async () => {
    const email = uniqueEmail();
    const username = uniqueUsername();
    const res = await request(baseUrl)
      .post("/api/auth/register")
      .send({ email, password: "correct-horse", username });

    expect(res.status).toBe(201);
    expect(Object.keys(res.body)).toEqual(["user"]);
    expect(res.body.user).toEqual({
      id: expect.any(String),
      email,
      username,
      theme: "warriors-europe",
      createdAt: expect.any(String),
    });
    expect(new Date(res.body.user.createdAt).toISOString()).toBe(
      res.body.user.createdAt,
    );
    expect(cookieOf(res)).toMatch(/^dc_session=/);
    createdUserIds.push(res.body.user.id);
  });

  it("400s on validation failures (bad email, short password, bad username, missing keys)", async () => {
    const cases = [
      {
        email: "not-an-email",
        password: "correct-horse",
        username: uniqueUsername(),
      },
      { email: uniqueEmail(), password: "short", username: uniqueUsername() },
      { email: uniqueEmail(), password: "correct-horse", username: "x" },
      {
        email: uniqueEmail(),
        password: "correct-horse",
        username: "has space",
      },
      { password: "correct-horse", username: uniqueUsername() },
    ];
    for (const body of cases) {
      const res = await request(baseUrl).post("/api/auth/register").send(body);
      expect(res.status).toBe(400);
      expect(Object.keys(res.body)).toEqual(["error"]);
      expect(typeof res.body.error).toBe("string");
    }
  });

  it("409 on duplicate email (case-insensitive)", async () => {
    const email = uniqueEmail();
    const first = await request(baseUrl)
      .post("/api/auth/register")
      .send({ email, password: "correct-horse", username: uniqueUsername() });
    createdUserIds.push(first.body.user.id);

    const second = await request(baseUrl).post("/api/auth/register").send({
      email: email.toUpperCase(),
      password: "correct-horse",
      username: uniqueUsername(),
    });

    expect(second.status).toBe(409);
    expect(second.body).toEqual({ error: "Email already registered" });
  });

  it("409 on duplicate username (case-insensitive)", async () => {
    const username = uniqueUsername();
    const first = await request(baseUrl)
      .post("/api/auth/register")
      .send({ email: uniqueEmail(), password: "correct-horse", username });
    createdUserIds.push(first.body.user.id);

    const second = await request(baseUrl).post("/api/auth/register").send({
      email: uniqueEmail(),
      password: "correct-horse",
      username: username.toUpperCase(),
    });

    expect(second.status).toBe(409);
    expect(second.body).toEqual({ error: "Username already taken" });
  });
});

describe("POST /api/auth/login", () => {
  it("logs in with 200 + User DTO + cookie", async () => {
    const email = uniqueEmail();
    const register = await request(baseUrl)
      .post("/api/auth/register")
      .send({ email, password: "correct-horse", username: uniqueUsername() });
    createdUserIds.push(register.body.user.id);

    const res = await request(baseUrl)
      .post("/api/auth/login")
      .send({ email, password: "correct-horse" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ user: register.body.user });
    expect(cookieOf(res)).toMatch(/^dc_session=/);
  });

  it("401 with the SAME message for unknown email and wrong password", async () => {
    const unknown = await request(baseUrl)
      .post("/api/auth/login")
      .send({ email: uniqueEmail(), password: "correct-horse" });
    expect(unknown.status).toBe(401);
    expect(unknown.body).toEqual({ error: "Invalid email or password" });

    const register = await request(baseUrl).post("/api/auth/register").send({
      email: uniqueEmail(),
      password: "correct-horse",
      username: uniqueUsername(),
    });
    createdUserIds.push(register.body.user.id);
    const wrongPassword = await request(baseUrl)
      .post("/api/auth/login")
      .send({ email: register.body.user.email, password: "wrong-horse" });
    expect(wrongPassword.status).toBe(401);
    expect(wrongPassword.body).toEqual({ error: "Invalid email or password" });
    expect(wrongPassword.body.error).toBe(unknown.body.error);
  });
});

describe("POST /api/auth/logout", () => {
  it("204 and clears the cookie, even with no session at all", async () => {
    const anonymous = await request(baseUrl).post("/api/auth/logout");
    expect(anonymous.status).toBe(204);
    expect(anonymous.body).toEqual({});
    const cleared = anonymous.headers["set-cookie"] as unknown as
      string[] | undefined;
    expect(cleared?.[0]).toMatch(/^dc_session=;/);

    const register = await request(baseUrl).post("/api/auth/register").send({
      email: uniqueEmail(),
      password: "correct-horse",
      username: uniqueUsername(),
    });
    createdUserIds.push(register.body.user.id);
    const logged = await request(baseUrl)
      .post("/api/auth/logout")
      .set("Cookie", cookieOf(register));
    expect(logged.status).toBe(204);
  });
});

describe("session gate (requireAuth)", () => {
  it('401 {"error":"Not authenticated"} without a cookie and with a garbage cookie', async () => {
    const noCookie = await request(baseUrl).get("/api/me");
    expect(noCookie.status).toBe(401);
    expect(noCookie.body).toEqual({ error: "Not authenticated" });

    const garbage = await request(baseUrl)
      .get("/api/me")
      .set("Cookie", "dc_session=not-a-jwt");
    expect(garbage.status).toBe(401);
    expect(garbage.body).toEqual({ error: "Not authenticated" });
  });
});

describe("login rate limit (10/min/IP)", () => {
  it("429 on the 11th rapid login attempt", async () => {
    // Fresh app instance: the limiter is in-memory and counts ALL login
    // requests per IP, so this check gets its own counter.
    const isolated = createApp();
    const isolatedServer = await new Promise<Server>((resolve) => {
      const s = isolated.listen(0, () => resolve(s));
    });
    const isolatedUrl = `http://127.0.0.1:${(isolatedServer.address() as AddressInfo).port}`;

    try {
      for (let attempt = 0; attempt < 10; attempt++) {
        const res = await request(isolatedUrl)
          .post("/api/auth/login")
          .send({ email: uniqueEmail(), password: "correct-horse" });
        expect(res.status).toBe(401); // still serving (rejected credentials)
      }

      const eleventh = await request(isolatedUrl)
        .post("/api/auth/login")
        .send({ email: uniqueEmail(), password: "correct-horse" });
      expect(eleventh.status).toBe(429);
      expect(Object.keys(eleventh.body)).toEqual(["error"]);
      expect(typeof eleventh.body.error).toBe("string");
    } finally {
      await new Promise<void>((resolve) => {
        isolatedServer.close(() => resolve());
      });
    }
  });
});
