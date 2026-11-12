import jwt from "jsonwebtoken";
import { describe, expect, it } from "vitest";
import { env } from "../../env";
import { signSession, verifySession } from "./token";

describe("JWT session token", () => {
  it("signs and verifies a token", () => {
    const token = signSession("user-123");
    expect(verifySession(token)).toEqual({ sub: "user-123" });
  });

  it("returns null for invalid tokens", () => {
    expect(verifySession("not-a-token")).toBeNull();
    expect(verifySession("")).toBeNull();
  });

  it("returns null for expired tokens", () => {
    const token = jwt.sign({ sub: "user-123" }, env.JWT_SECRET, {
      expiresIn: -10,
    });
    expect(verifySession(token)).toBeNull();
  });
});
