import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { config } from "../../config/index.js";
import { createPool } from "../../db/pool.js";
import { createServer } from "../../app.js";

function loadDotEnv(): void {
  if (process.env.DATABASE_URL && process.env.JWT_SECRET) return;
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const candidates = [
    path.resolve(__dirname, "../../../../.env"),
    path.resolve(__dirname, "../../../.env"),
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "../.env"),
  ];
  const envPath = candidates.find((p) => fs.existsSync(p));
  if (!envPath) return;
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1);
    const hash = value.indexOf(" #");
    if (hash !== -1) value = value.slice(0, hash);
    value = value.trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadDotEnv();

const databaseUrl = process.env.DATABASE_URL;
const jwtSecret = process.env.JWT_SECRET ?? "test-secret";
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for integration tests");
}

const pool = createPool(databaseUrl);

async function applySchema(): Promise<void> {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const schemaPath = path.resolve(__dirname, "../../db/schema.sql");
  const sql = fs.readFileSync(schemaPath, "utf8");
  await pool.query(sql);
}

function makeApp() {
  return createServer({ pool, jwtSecret, config });
}

function cookieFrom(res: request.Response): string {
  const set = res.headers["set-cookie"];
  const arr = Array.isArray(set) ? set : set ? [set] : [];
  const found = arr.find((c) => c.startsWith("dc_session="));
  if (!found) throw new Error("dc_session cookie not set");
  return found.split(";")[0];
}

describe("auth and users endpoints", () => {
  beforeAll(async () => {
    await applySchema();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM users");
  });

  afterAll(async () => {
    await pool.end();
  });

  it("register duplicate email and username return 409", async () => {
    const app = makeApp();
    const first = await request(app).post("/api/auth/register").send({
      email: "dup@example.com",
      password: "password123",
      username: "dupuser",
    });
    expect(first.status).toBe(201);

    const dupEmail = await request(app).post("/api/auth/register").send({
      email: "dup@example.com",
      password: "password123",
      username: "otheruser",
    });
    expect(dupEmail.status).toBe(409);
    expect(dupEmail.body).toEqual({ error: "Email already registered" });

    const dupUser = await request(app).post("/api/auth/register").send({
      email: "other@example.com",
      password: "password123",
      username: "dupuser",
    });
    expect(dupUser.status).toBe(409);
    expect(dupUser.body).toEqual({ error: "Username already taken" });
  });

  it("login wrong password returns 401 same message", async () => {
    const app = makeApp();
    await request(app).post("/api/auth/register").send({
      email: "login@example.com",
      password: "password123",
      username: "loginuser",
    });

    const wrong = await request(app).post("/api/auth/login").send({
      email: "login@example.com",
      password: "wrongpass",
    });
    expect(wrong.status).toBe(401);
    expect(wrong.body).toEqual({ error: "Invalid email or password" });

    const unknown = await request(app).post("/api/auth/login").send({
      email: "nobody@example.com",
      password: "password123",
    });
    expect(unknown.status).toBe(401);
    expect(unknown.body).toEqual({ error: "Invalid email or password" });
  });

  it("register→login→me→patch username→password change→logout round trip", async () => {
    const app = makeApp();

    const regBad = await request(app).post("/api/auth/register").send({
      email: "not-an-email",
      password: "short",
      username: "ab",
    });
    expect(regBad.status).toBe(400);
    expect(typeof regBad.body.error).toBe("string");

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
    const regCookie = cookieFrom(reg);

    const meUnauth = await request(app).get("/api/me");
    expect(meUnauth.status).toBe(401);
    expect(meUnauth.body).toEqual({ error: "Not authenticated" });

    const loginBad = await request(app).post("/api/auth/login").send({});
    expect(loginBad.status).toBe(400);

    const login = await request(app).post("/api/auth/login").send({
      email: "carlos@example.com",
      password: "correct-horse",
    });
    expect(login.status).toBe(200);
    expect(login.body.user.email).toBe("carlos@example.com");
    const loginCookie = cookieFrom(login);

    const me = await request(app).get("/api/me").set("Cookie", [loginCookie]);
    expect(me.status).toBe(200);
    expect(me.body.user.username).toBe("Carlos");

    const patchBad = await request(app).patch("/api/me").set("Cookie", [loginCookie]).send({});
    expect(patchBad.status).toBe(400);

    const patchUnknownTheme = await request(app)
      .patch("/api/me")
      .set("Cookie", [loginCookie])
      .send({ theme: "nope" });
    expect(patchUnknownTheme.status).toBe(400);
    expect(patchUnknownTheme.body).toEqual({ error: "Unknown theme" });

    const patch = await request(app)
      .patch("/api/me")
      .set("Cookie", [loginCookie])
      .send({ username: "NewName" });
    expect(patch.status).toBe(200);
    expect(patch.body.user.username).toBe("NewName");

    const pwBad = await request(app)
      .patch("/api/me/password")
      .set("Cookie", [loginCookie])
      .send({ currentPassword: "wrong", newPassword: "newpassword123" });
    expect(pwBad.status).toBe(401);
    expect(pwBad.body).toEqual({ error: "Current password is incorrect" });

    const pwShort = await request(app)
      .patch("/api/me/password")
      .set("Cookie", [loginCookie])
      .send({ currentPassword: "correct-horse", newPassword: "short" });
    expect(pwShort.status).toBe(400);

    const pw = await request(app)
      .patch("/api/me/password")
      .set("Cookie", [loginCookie])
      .send({ currentPassword: "correct-horse", newPassword: "newpassword123" });
    expect(pw.status).toBe(204);

    const oldLogin = await request(app).post("/api/auth/login").send({
      email: "carlos@example.com",
      password: "correct-horse",
    });
    expect(oldLogin.status).toBe(401);
    expect(oldLogin.body).toEqual({ error: "Invalid email or password" });

    const newLogin = await request(app).post("/api/auth/login").send({
      email: "carlos@example.com",
      password: "newpassword123",
    });
    expect(newLogin.status).toBe(200);
    expect(newLogin.body.user.username).toBe("NewName");

    const logout = await request(app).post("/api/auth/logout").set("Cookie", [regCookie]);
    expect(logout.status).toBe(204);

    const logoutAgain = await request(app).post("/api/auth/logout");
    expect(logoutAgain.status).toBe(204);

    // GET /api/meta is public and matches contract subset
    const meta = await request(app).get("/api/meta");
    expect(meta.status).toBe(200);
    expect(meta.body.boardSize).toBe(8);
    expect(meta.body.maxActiveGames).toBe(5);
    expect(meta.body.classes.sword.count).toBe(2);
    expect(meta.body.classes.healer.healAmount).toBe(8);
    expect(meta.body.personalities.aggressive).toEqual({ label: "Aggressive" });
    expect(meta.body.personalities.aggressive.temperature).toBeUndefined();
    expect(meta.body.themes).toEqual(config.themes);
    expect(meta.body.lore.sword).toBeTruthy();
  });

  it("rate limit fires 429 on 11th rapid login attempt", async () => {
    const app = makeApp();
    await request(app).post("/api/auth/register").send({
      email: "rate@example.com",
      password: "password123",
      username: "rateuser",
    });

    let lastStatus = 0;
    for (let i = 0; i < 11; i++) {
      const res = await request(app).post("/api/auth/login").send({
        email: "rate@example.com",
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
