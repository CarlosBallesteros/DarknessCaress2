import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { useTestDb } from "../../test-db.js";
import { uniqueEmail, uniqueUsername } from "../../test-ids.js";
import { SESSION_COOKIE } from "../auth/auth.tokens.js";

const app = createApp();

function cookieOf(res: request.Response): string {
  return (res.headers["set-cookie"] as unknown as string[])[0];
}

describe("auth + profile round trip", () => {
  useTestDb();

  it("register → login → me → patch username → password change → logout", async () => {
    const email = uniqueEmail();
    const password = "correct-horse";
    const username = uniqueUsername();

    const registerRes = await request(app)
      .post("/api/auth/register")
      .send({ email, password, username });
    expect(registerRes.status).toBe(201);
    const cookie = cookieOf(registerRes);

    const meRes = await request(app).get("/api/me").set("Cookie", cookie);
    expect(meRes.status).toBe(200);
    expect(meRes.body.user).toMatchObject({ email, username });

    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ email, password });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.user).toMatchObject({ email, username });

    const newUsername = uniqueUsername();
    const patchRes = await request(app)
      .patch("/api/me")
      .set("Cookie", cookie)
      .send({ username: newUsername });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.user.username).toBe(newUsername);

    const themeRes = await request(app)
      .patch("/api/me")
      .set("Cookie", cookie)
      .send({ theme: "warriors-europe" });
    expect(themeRes.status).toBe(200);
    expect(themeRes.body.user.theme).toBe("warriors-europe");

    const newPassword = "stallion-plate";
    const changeRes = await request(app)
      .patch("/api/me/password")
      .set("Cookie", cookie)
      .send({ currentPassword: password, newPassword });
    expect(changeRes.status).toBe(204);

    const oldLoginRes = await request(app)
      .post("/api/auth/login")
      .send({ email, password });
    expect(oldLoginRes.status).toBe(401);
    const newLoginRes = await request(app)
      .post("/api/auth/login")
      .send({ email, password: newPassword });
    expect(newLoginRes.status).toBe(200);

    const logoutRes = await request(app)
      .post("/api/auth/logout")
      .set("Cookie", cookie);
    expect(logoutRes.status).toBe(204);
    expect((logoutRes.headers["set-cookie"] as unknown as string[])[0]).toMatch(
      new RegExp(`^${SESSION_COOKIE}=;`),
    );
  });

  it("PATCH /api/me with no keys → 400", async () => {
    const registerRes = await request(app).post("/api/auth/register").send({
      email: uniqueEmail(),
      password: "correct-horse",
      username: uniqueUsername(),
    });
    const res = await request(app)
      .patch("/api/me")
      .set("Cookie", cookieOf(registerRes))
      .send({});
    expect(res.status).toBe(400);
  });

  it("PATCH /api/me with an unknown theme → 400 Unknown theme", async () => {
    const registerRes = await request(app).post("/api/auth/register").send({
      email: uniqueEmail(),
      password: "correct-horse",
      username: uniqueUsername(),
    });
    const res = await request(app)
      .patch("/api/me")
      .set("Cookie", cookieOf(registerRes))
      .send({ theme: "no-such-theme" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Unknown theme" });
  });

  it("PATCH /api/me with a taken username → 409, but keeping your own name passes", async () => {
    const first = await request(app).post("/api/auth/register").send({
      email: uniqueEmail(),
      password: "correct-horse",
      username: uniqueUsername(),
    });
    const second = await request(app).post("/api/auth/register").send({
      email: uniqueEmail(),
      password: "correct-horse",
      username: uniqueUsername(),
    });
    const firstUsername = (
      await request(app).get("/api/me").set("Cookie", cookieOf(first))
    ).body.user.username as string;

    const takenRes = await request(app)
      .patch("/api/me")
      .set("Cookie", cookieOf(second))
      .send({ username: firstUsername.toUpperCase() });
    expect(takenRes.status).toBe(409);
    expect(takenRes.body).toEqual({ error: "Username already taken" });

    const ownRes = await request(app)
      .patch("/api/me")
      .set("Cookie", cookieOf(first))
      .send({ username: firstUsername.toUpperCase() });
    expect(ownRes.status).toBe(200);
    expect(ownRes.body.user.username).toBe(firstUsername.toUpperCase());
  });

  it("PATCH /api/me/password with a wrong current password → 401", async () => {
    const registerRes = await request(app).post("/api/auth/register").send({
      email: uniqueEmail(),
      password: "correct-horse",
      username: uniqueUsername(),
    });
    const res = await request(app)
      .patch("/api/me/password")
      .set("Cookie", cookieOf(registerRes))
      .send({ currentPassword: "wrong-password", newPassword: "new-password" });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Current password is incorrect" });
  });

  it("401 without a session cookie", async () => {
    const res = await request(app)
      .patch("/api/me")
      .send({ theme: "warriors-europe" });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Not authenticated" });
  });
});
