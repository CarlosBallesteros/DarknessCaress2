import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import bcrypt from "bcrypt";
import { ensureTestEnv } from "../../test/env.js";
import { resetUsers, setupDbApp } from "../../test/helpers.js";
import {
  BCRYPT_COST,
  SESSION_COOKIE,
  hashPassword,
  requireAuth,
  signSession,
  verifyPassword,
  verifySessionToken,
} from "./core.js";
import express from "express";
import cookieParser from "cookie-parser";

ensureTestEnv();

describe("auth unit", () => {
  it("password hashing uses bcrypt cost 10 and verifies", async () => {
    const hash = await hashPassword("correct-horse");
    expect(hash.startsWith("$2b$10$") || hash.startsWith("$2a$10$")).toBe(true);
    expect(await bcrypt.compare("correct-horse", hash)).toBe(true);
    expect(await verifyPassword("correct-horse", hash)).toBe(true);
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
    expect(BCRYPT_COST).toBe(10);
  });

  it("JWT verify succeeds for valid token and fails when expired", async () => {
    const token = signSession("11111111-1111-1111-1111-111111111111");
    const payload = verifySessionToken(token);
    expect(payload).toEqual({ sub: "11111111-1111-1111-1111-111111111111" });

    const expired = signSession("11111111-1111-1111-1111-111111111111", -1);
    expect(verifySessionToken(expired)).toBeNull();
    expect(verifySessionToken("not-a-token")).toBeNull();
  });

  it("requireAuth returns 401 when missing or invalid", async () => {
    const app = express();
    app.use(cookieParser());
    app.get("/protected", requireAuth, (_req, res) => {
      res.status(200).json({ ok: true });
    });

    const missing = await request(app).get("/protected");
    expect(missing.status).toBe(401);
    expect(missing.body).toEqual({ error: "Not authenticated" });

    const invalid = await request(app)
      .get("/protected")
      .set("Cookie", [`${SESSION_COOKIE}=invalid.token.value`]);
    expect(invalid.status).toBe(401);
    expect(invalid.body).toEqual({ error: "Not authenticated" });
  });
});

describe("auth unit (db-backed cases)", () => {
  let app: Awaited<ReturnType<typeof setupDbApp>>;

  beforeAll(async () => {
    app = await setupDbApp();
  });

  beforeEach(async () => {
    await resetUsers();
  });

  it("register dup returns 409 for email and username", async () => {
    const first = await request(app).post("/api/auth/register").send({
      email: "dup@example.com",
      password: "correct-horse",
      username: "DupUser",
    });
    expect(first.status).toBe(201);

    const dupEmail = await request(app).post("/api/auth/register").send({
      email: "dup@example.com",
      password: "correct-horse",
      username: "AnotherUser",
    });
    expect(dupEmail.status).toBe(409);
    expect(dupEmail.body).toEqual({ error: "Email already registered" });

    const dupUsername = await request(app).post("/api/auth/register").send({
      email: "other@example.com",
      password: "correct-horse",
      username: "DupUser",
    });
    expect(dupUsername.status).toBe(409);
    expect(dupUsername.body).toEqual({ error: "Username already taken" });
  });

  it("login wrong-password returns 401 same message as unknown email", async () => {
    await request(app).post("/api/auth/register").send({
      email: "login@example.com",
      password: "correct-horse",
      username: "LoginUser",
    });

    const wrongPassword = await request(app).post("/api/auth/login").send({
      email: "login@example.com",
      password: "wrong-password",
    });
    expect(wrongPassword.status).toBe(401);
    expect(wrongPassword.body).toEqual({ error: "Invalid email or password" });

    const unknownEmail = await request(app).post("/api/auth/login").send({
      email: "nobody@example.com",
      password: "whatever-pass",
    });
    expect(unknownEmail.status).toBe(401);
    expect(unknownEmail.body).toEqual({ error: "Invalid email or password" });
  });
});
