import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { useTestDb } from "../../test-db.js";
import { uniqueEmail, uniqueUsername } from "../../test-ids.js";

const app = createApp();

describe("login rate limit", () => {
  useTestDb();

  it("fires 429 on the 11th rapid login attempt", async () => {
    const email = uniqueEmail();
    await request(app)
      .post("/api/auth/register")
      .send({ email, password: "correct-horse", username: uniqueUsername() });

    // First 10 attempts pass through the limiter (wrong password → 401).
    for (let attempt = 0; attempt < 10; attempt++) {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ email, password: "wrong-password" });
      expect(res.status).toBe(401);
    }

    const eleventh = await request(app)
      .post("/api/auth/login")
      .send({ email, password: "wrong-password" });
    expect(eleventh.status).toBe(429);
  });
});
