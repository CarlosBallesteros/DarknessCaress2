import jwt from "jsonwebtoken";
import type { Response } from "express";

// 01-architecture.md: JWT (sub = user id, exp 7d), httpOnly SameSite=Lax cookie.
const TOKEN_TTL = "7d";
export const SESSION_COOKIE = "dc_session";

function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set");
  return secret;
}

export function signSessionToken(userId: string): string {
  return jwt.sign({ sub: userId }, jwtSecret(), { expiresIn: TOKEN_TTL });
}

/** Returns the token's user id, or null when missing/expired/forged. */
export function verifySessionToken(token: string): string | null {
  try {
    const payload = jwt.verify(token, jwtSecret());
    if (typeof payload === "string") return null;
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

export function setSessionCookie(res: Response, userId: string): void {
  res.cookie(SESSION_COOKIE, signSessionToken(userId), {
    httpOnly: true,
    sameSite: "lax",
  });
}
