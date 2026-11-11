// Session token + cookie mechanics (docs/01 Auth mechanics): JWT (sub = user
// id, exp 7d) signed with JWT_SECRET, delivered as httpOnly SameSite=Lax
// cookie `dc_session`.
import type { Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../../env";

export const SESSION_COOKIE = "dc_session";
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7d

export interface SessionPayload {
  sub: string;
}

export function signSession(userId: string): string {
  return jwt.sign({ sub: userId }, env.JWT_SECRET, {
    expiresIn: SESSION_TTL_SECONDS,
  });
}

export function verifySession(token: string): SessionPayload | null {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET);
    if (
      typeof payload === "object" &&
      payload !== null &&
      typeof payload.sub === "string"
    ) {
      return { sub: payload.sub };
    }
    return null;
  } catch {
    return null; // expired, malformed, or bad signature all mean "no session"
  }
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: SESSION_TTL_SECONDS * 1000,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE);
}
