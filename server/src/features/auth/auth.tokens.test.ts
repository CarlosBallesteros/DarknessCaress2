import jwt from "jsonwebtoken";
import { describe, expect, it } from "vitest";
import { signSessionToken, verifySessionToken } from "./auth.tokens.js";

const secret = process.env.JWT_SECRET!;

describe("session tokens", () => {
  it("round-trips the user id in the sub claim", () => {
    const token = signSessionToken("0b9c4e1a-7c1d-4a5e-9a1b-2c3d4e5f6a7b");
    expect(verifySessionToken(token)).toBe(
      "0b9c4e1a-7c1d-4a5e-9a1b-2c3d4e5f6a7b",
    );
  });

  it("rejects a garbage token", () => {
    expect(verifySessionToken("not-a-token")).toBeNull();
  });

  it("rejects an expired token", () => {
    const token = jwt.sign({ sub: "expired-user" }, secret, {
      expiresIn: -10,
    });
    expect(verifySessionToken(token)).toBeNull();
  });

  it("rejects a token signed with another secret", () => {
    const token = jwt.sign({ sub: "forged-user" }, "some-other-secret");
    expect(verifySessionToken(token)).toBeNull();
  });
});
