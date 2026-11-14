import request from "supertest";
import { describe, expect, it } from "vitest";

process.env.DATABASE_URL ??= "postgres://dc:dc@localhost:5432/darknesscaress";
process.env.JWT_SECRET ??= "test-secret";
process.env.OLLAMA_URL ??= "http://localhost:11434";
process.env.OLLAMA_MODEL ??= "qwen2.5:7b-instruct-q4_K_M";
process.env.PORT ??= "3000";
process.env.NODE_ENV ??= "test";

describe("GET /api/health", () => {
  it("returns ok", async () => {
    const { app } = await import("./app");
    const response = await request(app).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });
});
