import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "../../app";
import { migrate } from "../../db/migrate";
import { pool } from "../../db/pool";

// docs/01: login is rate limited at max 10 requests/min/IP, in-memory —
// so the 11th rapid attempt is 429 while the first ten pass through to the
// login logic (401 for an unknown account here).
describe("login rate limit", () => {
  beforeAll(async () => {
    await migrate();
  });

  afterAll(async () => {
    await pool.end();
  });

  it("401s the first ten attempts and 429s the 11th", async () => {
    const app = createServer();
    const body = { email: "nobody@dc2-test.example", password: "whatever123" };
    const statuses: number[] = [];
    let last: { status: number; body: unknown } | undefined;
    for (let attempt = 1; attempt <= 11; attempt++) {
      const res = await request(app).post("/api/auth/login").send(body);
      statuses.push(res.status);
      last = { status: res.status, body: res.body };
    }
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(401));
    expect(statuses[10]).toBe(429);
    expect(last).toBeDefined();
    expect(last?.status).toBe(429);
    expect(typeof (last?.body as { error?: string }).error).toBe("string");
  });
});
