import { describe, it, expect } from "vitest";
import { createServer } from "./app";
import supertest from "supertest";

describe("GET /api/health", () => {
  it("returns 200 with { ok: true } and requires no auth", async () => {
    const app = createServer();
    const res = await supertest(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
