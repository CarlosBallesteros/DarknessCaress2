import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { describe, expect, it } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { env } from "../../env";
import { HttpError } from "../../httpError";
import { requireAuth } from "./requireAuth";
import { sessionUserId } from "./token";

describe("password hashing", () => {
  it("hashes at cost 10 and verifies", async () => {
    const hash = await bcrypt.hash("correct-horse", 10);
    expect(bcrypt.getRounds(hash)).toBe(10);
    expect(await bcrypt.compare("correct-horse", hash)).toBe(true);
    expect(await bcrypt.compare("wrong-horse", hash)).toBe(false);
  });
});

describe("session token (JWT sub, exp 7d)", () => {
  it("round-trips a signed token to its sub", () => {
    const token = jwt.sign({ sub: "u-1" }, env.JWT_SECRET, { expiresIn: 7 * 24 * 60 * 60 });
    expect(sessionUserId(token)).toBe("u-1");
  });

  it("rejects an expired token", () => {
    const expired = jwt.sign(
      { sub: "u-1", exp: Math.floor(Date.now() / 1000) - 1 },
      env.JWT_SECRET,
    );
    expect(sessionUserId(expired)).toBeNull();
  });

  it("rejects tampered, malformed and missing tokens", () => {
    const token = jwt.sign({ sub: "u-1" }, env.JWT_SECRET, { expiresIn: 7 * 24 * 60 * 60 });
    expect(sessionUserId(`${token}x`)).toBeNull();
    expect(sessionUserId("garbage")).toBeNull();
    expect(sessionUserId(undefined)).toBeNull();
  });
});

describe("requireAuth", () => {
  async function nextError(req: Partial<Request>): Promise<unknown> {
    let captured: unknown;
    const next: NextFunction = (err) => {
      captured = err;
    };
    await requireAuth(req as Request, {} as Response, next);
    return captured;
  }

  it("401s with no cookie", async () => {
    const err = await nextError({ cookies: {} });
    expect(err).toBeInstanceOf(HttpError);
    const httpError = err as HttpError;
    expect(httpError.status).toBe(401);
    expect(httpError.message).toBe("Not authenticated");
  });

  it("401s with an invalid cookie value", async () => {
    const err = await nextError({ cookies: { dc_session: "garbage" } });
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(401);
    expect((err as HttpError).message).toBe("Not authenticated");
  });
});
