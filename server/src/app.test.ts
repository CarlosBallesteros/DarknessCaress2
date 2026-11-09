import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

describe("health endpoint", () => {
  it("GET /api/health returns { ok: true } without auth", async () => {
    const res = await request(createApp()).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
