import jwt from "jsonwebtoken";
import { describe, expect, it } from "vitest";
import { ensureTestEnv } from "../../test/env";

ensureTestEnv();

describe("JWT session", () => {
  it("signs and verifies a session token", async () => {
    const { signSession, verifySession } = await import("./session");
    const token = signSession("user-123");
    expect(verifySession(token)).toEqual({ sub: "user-123" });
  });

  it("rejects an expired token", async () => {
    const { verifySession } = await import("./session");
    const token = jwt.sign({ sub: "user-123" }, process.env.JWT_SECRET!, {
      expiresIn: -10,
    });
    expect(() => verifySession(token)).toThrow();
  });
});
