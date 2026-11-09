import jwt from "jsonwebtoken";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { useTestDb } from "../../test-db.js";
import { uniqueEmail, uniqueUsername } from "../../test-ids.js";
import { SESSION_COOKIE } from "./auth.tokens.js";

const app = createApp();

function registerBody() {
  return {
    email: uniqueEmail(),
    password: "correct-horse",
    username: uniqueUsername(),
  };
}

function setCookieOf(res: request.Response): string {
  const cookie = (res.headers["set-cookie"] as unknown as string[])[0];
  expect(cookie.startsWith(SESSION_COOKIE)).toBe(true);
  return cookie;
}

describe("POST /api/auth/register", () => {
  useTestDb();

  it("201 with the user DTO and a session cookie", async () => {
    const body = registerBody();
    const res = await request(app).post("/api/auth/register").send(body);
    expect(res.status).toBe(201);
    expect(res.body.user).toEqual({
      id: expect.any(String),
      email: body.email,
      username: body.username,
      theme: "warriors-europe",
      createdAt: expect.any(String),
    });
    setCookieOf(res);
  });

  it("409 Email already registered on duplicate email", async () => {
    const body = registerBody();
    await request(app).post("/api/auth/register").send(body);
    const res = await request(app)
      .post("/api/auth/register")
      .send({ ...body, username: uniqueUsername() });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "Email already registered" });
  });

  it("409 Username already taken on duplicate username (case-insensitive)", async () => {
    const body = registerBody();
    await request(app).post("/api/auth/register").send(body);
    const res = await request(app)
      .post("/api/auth/register")
      .send({
        ...body,
        email: uniqueEmail(),
        username: body.username.toUpperCase(),
      });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "Username already taken" });
  });

  it("400 on invalid email, short password, bad username", async () => {
    const base = { password: "correct-horse", username: uniqueUsername() };
    const badEmail = await request(app)
      .post("/api/auth/register")
      .send({ ...base, email: "not-an-email" });
    expect(badEmail.status).toBe(400);

    const shortPassword = await request(app).post("/api/auth/register").send({
      email: uniqueEmail(),
      password: "short",
      username: uniqueUsername(),
    });
    expect(shortPassword.status).toBe(400);
    expect(shortPassword.body.error).toBe(
      "Password must be at least 8 characters",
    );

    const badUsername = await request(app).post("/api/auth/register").send({
      email: uniqueEmail(),
      password: "correct-horse",
      username: "bad name!",
    });
    expect(badUsername.status).toBe(400);
  });
});

describe("POST /api/auth/login", () => {
  useTestDb();

  it("401 with the SAME body for unknown email and wrong password", async () => {
    const body = registerBody();
    await request(app).post("/api/auth/register").send(body);

    const wrongPassword = await request(app)
      .post("/api/auth/login")
      .send({ email: body.email, password: "wrong-password" });
    const unknownEmail = await request(app)
      .post("/api/auth/login")
      .send({ email: uniqueEmail(), password: "wrong-password" });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknownEmail.body);
    expect(wrongPassword.body).toEqual({ error: "Invalid email or password" });
  });

  it("400 on malformed body", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "not-an-email", password: "" });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/auth/logout", () => {
  it("204 and clears the cookie, even with no session", async () => {
    const res = await request(app).post("/api/auth/logout");
    expect(res.status).toBe(204);
    const cleared = (res.headers["set-cookie"] as unknown as string[])[0];
    expect(cleared).toMatch(/^dc_session=;/);
  });
});

describe("requireAuth", () => {
  useTestDb();

  it("401 Not authenticated without a cookie", async () => {
    const res = await request(app).get("/api/me");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Not authenticated" });
  });

  it("401 Not authenticated with a garbage cookie", async () => {
    const res = await request(app)
      .get("/api/me")
      .set("Cookie", `${SESSION_COOKIE}=garbage`);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Not authenticated" });
  });

  it("401 Not authenticated with an expired token", async () => {
    const token = jwt.sign(
      { sub: "00000000-0000-0000-0000-000000000000" },
      process.env.JWT_SECRET!,
      {
        expiresIn: -10,
      },
    );
    const res = await request(app)
      .get("/api/me")
      .set("Cookie", `${SESSION_COOKIE}=${token}`);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Not authenticated" });
  });
});
