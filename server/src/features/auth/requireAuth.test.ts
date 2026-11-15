import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createRequireAuth } from "./requireAuth.js";
import { signSessionToken } from "./jwt.js";

describe("requireAuth", () => {
  it("returns 401 when not authenticated", async () => {
    const fakePool = {
      query: async () => ({ rows: [] }),
    } as never;
    const app = express();
    app.use(cookieParser());
    const requireAuth = createRequireAuth(fakePool, "secret");
    app.get("/protected", requireAuth, (_req, res) => {
      res.status(200).json({ ok: true });
    });

    const res = await request(app).get("/protected");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Not authenticated" });
  });

  it("returns 401 for invalid token", async () => {
    const fakePool = {
      query: async () => ({ rows: [] }),
    } as never;
    const app = express();
    app.use(cookieParser());
    const requireAuth = createRequireAuth(fakePool, "secret");
    app.get("/protected", requireAuth, (_req, res) => {
      res.status(200).json({ ok: true });
    });

    const res = await request(app).get("/protected").set("Cookie", ["dc_session=badtoken"]);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Not authenticated" });
  });

  it("allows valid token for existing user", async () => {
    const fakePool = {
      query: async () => ({
        rows: [
          {
            id: "u1",
            email: "a@b.com",
            username: "alice",
            password_hash: "hash",
            theme: "warriors-europe",
            created_at: new Date("2026-01-01T00:00:00.000Z"),
          },
        ],
      }),
    } as never;
    const app = express();
    app.use(cookieParser());
    const requireAuth = createRequireAuth(fakePool, "secret");
    app.get("/protected", requireAuth, (req, res) => {
      res.status(200).json({ user: (req as unknown as { user: unknown }).user });
    });
    const token = signSessionToken("u1", "secret");
    const res = await request(app)
      .get("/protected")
      .set("Cookie", [`dc_session=${token}`]);
    expect(res.status).toBe(200);
    expect((res.body as { user: { id: string } }).user.id).toBe("u1");
  });
});
