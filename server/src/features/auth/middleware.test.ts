import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { ensureTestEnv } from "../../test/env";
import { requireAuth } from "./middleware";

ensureTestEnv();

describe("requireAuth", () => {
  it("returns 401 when not authenticated", async () => {
    const app = express();
    app.get("/protected", requireAuth, (_req, res) => {
      res.json({ ok: true });
    });

    const res = await request(app).get("/protected");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Not authenticated" });
  });
});
