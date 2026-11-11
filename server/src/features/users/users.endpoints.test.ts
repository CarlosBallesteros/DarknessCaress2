// Endpoint tests for the users feature (docs/06 endpoints 4–6, docs/09 phase
// 2): the full register→login→me→patch username→password change→logout round
// trip plus every contract status, including the 400s. Runs against the real
// (loopback) database — fresh unique credentials per run.
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

async function registerUser(): Promise<request.Response> {
  const res = await request(baseUrl).post("/api/auth/register").send({
    email: uniqueEmail(),
    password: "correct-horse",
    username: uniqueUsername(),
  });
  expect(res.status).toBe(201);
  createdUserIds.push(res.body.user.id);
  return res;
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

describe("register→login→me→patch username→password change→logout round trip", () => {
  it("walks the whole journey with contract statuses", async () => {
    // 1. register → 201 {"user": User} + cookie
    const register = await request(baseUrl).post("/api/auth/register").send({
      email: uniqueEmail(),
      password: "correct-horse",
      username: uniqueUsername(),
    });
    expect(register.status).toBe(201);
    createdUserIds.push(register.body.user.id);
    const sessionCookie = cookieOf(register);

    // 2. login → 200 {"user": User} + cookie
    const login = await request(baseUrl).post("/api/auth/login").send({
      email: register.body.user.email,
      password: "correct-horse",
    });
    expect(login.status).toBe(200);
    expect(login.body).toEqual({ user: register.body.user });
    const loginCookie = cookieOf(login);

    // 3. me → 200 {"user": User}
    const me = await request(baseUrl).get("/api/me").set("Cookie", loginCookie);
    expect(me.status).toBe(200);
    expect(me.body).toEqual({ user: register.body.user });

    // 4. patch username → 200 {"user": User} with the new username
    const newUsername = uniqueUsername();
    const patch = await request(baseUrl)
      .patch("/api/me")
      .set("Cookie", loginCookie)
      .send({ username: newUsername });
    expect(patch.status).toBe(200);
    expect(patch.body.user.username).toBe(newUsername);
    expect(patch.body.user.id).toBe(register.body.user.id);

    // me reflects the change
    const meAfter = await request(baseUrl)
      .get("/api/me")
      .set("Cookie", loginCookie);
    expect(meAfter.body.user.username).toBe(newUsername);

    // 5. password change → 204
    const passwordChange = await request(baseUrl)
      .patch("/api/me/password")
      .set("Cookie", loginCookie)
      .send({
        currentPassword: "correct-horse",
        newPassword: "new-correct-horse",
      });
    expect(passwordChange.status).toBe(204);
    expect(passwordChange.body).toEqual({});

    // old password now fails login with the contract message…
    const oldLogin = await request(baseUrl).post("/api/auth/login").send({
      email: register.body.user.email,
      password: "correct-horse",
    });
    expect(oldLogin.status).toBe(401);
    expect(oldLogin.body).toEqual({ error: "Invalid email or password" });

    // …and the new one succeeds
    const newLogin = await request(baseUrl).post("/api/auth/login").send({
      email: register.body.user.email,
      password: "new-correct-horse",
    });
    expect(newLogin.status).toBe(200);

    // 6. logout → 204; it clears the cookie (no revocation machinery in MVP,
    // docs/01) — following the CLEARED cookie the way a real client does, /api/me is 401 again
    const logout = await request(baseUrl)
      .post("/api/auth/logout")
      .set("Cookie", sessionCookie);
    expect(logout.status).toBe(204);
    const clearedCookie = (
      logout.headers["set-cookie"] as unknown as string[]
    )[0].split(";")[0];
    expect(clearedCookie).toMatch(/^dc_session=;?$/);
    const meAfterLogout = await request(baseUrl)
      .get("/api/me")
      .set("Cookie", clearedCookie);
    expect(meAfterLogout.status).toBe(401);
    expect(meAfterLogout.body).toEqual({ error: "Not authenticated" });
  });
});

describe("PATCH /api/me", () => {
  it("accepts username only, theme only, and both together", async () => {
    const register = await registerUser();
    const cookie = cookieOf(register);

    const theme = await request(baseUrl)
      .patch("/api/me")
      .set("Cookie", cookie)
      .send({ theme: "warriors-europe" });
    expect(theme.status).toBe(200);
    expect(theme.body.user.theme).toBe("warriors-europe");

    const both = await request(baseUrl)
      .patch("/api/me")
      .set("Cookie", cookie)
      .send({ username: uniqueUsername(), theme: "warriors-europe" });
    expect(both.status).toBe(200);
  });

  it('400 {"error":"Unknown theme"} for a theme not in config', async () => {
    const register = await registerUser();
    const res = await request(baseUrl)
      .patch("/api/me")
      .set("Cookie", cookieOf(register))
      .send({ theme: "not-a-theme" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Unknown theme" });
  });

  it("400 when no key is present (at least one required)", async () => {
    const register = await registerUser();
    const res = await request(baseUrl)
      .patch("/api/me")
      .set("Cookie", cookieOf(register))
      .send({});
    expect(res.status).toBe(400);
    expect(Object.keys(res.body)).toEqual(["error"]);
  });

  it("400 on an invalid username shape", async () => {
    const register = await registerUser();
    const res = await request(baseUrl)
      .patch("/api/me")
      .set("Cookie", cookieOf(register))
      .send({ username: "bad name!" });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body)).toEqual(["error"]);
  });

  it("409 Username-already-taken body for someone else's username", async () => {
    const first = await registerUser();
    const second = await registerUser();

    const res = await request(baseUrl)
      .patch("/api/me")
      .set("Cookie", cookieOf(second))
      .send({ username: first.body.user.username });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "Username already taken" });
  });

  it("401 without a session", async () => {
    const res = await request(baseUrl)
      .patch("/api/me")
      .send({ username: uniqueUsername() });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Not authenticated" });
  });
});

describe("PATCH /api/me/password", () => {
  it('401 {"error":"Current password is incorrect"} on a wrong current password', async () => {
    const register = await registerUser();
    const res = await request(baseUrl)
      .patch("/api/me/password")
      .set("Cookie", cookieOf(register))
      .send({
        currentPassword: "wrong-horse",
        newPassword: "new-correct-horse",
      });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Current password is incorrect" });
  });

  it("400 on a too-short new password", async () => {
    const register = await registerUser();
    const res = await request(baseUrl)
      .patch("/api/me/password")
      .set("Cookie", cookieOf(register))
      .send({ currentPassword: "correct-horse", newPassword: "short" });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body)).toEqual(["error"]);
  });

  it("401 without a session", async () => {
    const res = await request(baseUrl).patch("/api/me/password").send({
      currentPassword: "correct-horse",
      newPassword: "new-correct-horse",
    });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Not authenticated" });
  });
});
