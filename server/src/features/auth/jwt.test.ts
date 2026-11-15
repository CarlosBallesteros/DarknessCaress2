import jwt from "jsonwebtoken";
import { describe, expect, it } from "vitest";
import { signSessionToken, verifySessionToken } from "./jwt.js";

describe("jwt session token", () => {
  const secret = "test-secret";

  it("signs and verifies a token", () => {
    const token = signSessionToken("user-123", secret);
    const payload = verifySessionToken(token, secret);
    expect(payload).toEqual({ sub: "user-123" });
  });

  it("rejects invalid tokens", () => {
    expect(verifySessionToken("not-a-token", secret)).toBeNull();
  });

  it("rejects expired tokens", () => {
    const token = jwt.sign({ sub: "user-123" }, secret, { expiresIn: -1 });
    expect(verifySessionToken(token, secret)).toBeNull();
  });
});
