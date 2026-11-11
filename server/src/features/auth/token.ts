import jwt from "jsonwebtoken";
import type { Response } from "express";
import { env } from "../../env";

// Session per docs/01: JWT (sub = user id, exp 7d) signed with JWT_SECRET,
// delivered as an httpOnly, SameSite=Lax cookie named dc_session.
const COOKIE_NAME = "dc_session";
const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60;

export function setSessionCookie(res: Response, userId: string): void {
  const token = jwt.sign({ sub: userId }, env.JWT_SECRET, { expiresIn: SEVEN_DAYS_SECONDS });
  // maxAge mirrors the JWT exp so the cookie never outlives (or dies before) it.
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: SEVEN_DAYS_SECONDS * 1000,
  });
}

export function clearSessionCookie(res: Response): void {
  // Must mirror the setting options for the browser to actually drop the cookie.
  res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: "lax" });
}

export function sessionUserId(token: string | undefined): string | null {
  if (!token) {
    return null;
  }
  try {
    const payload = jwt.verify(token, env.JWT_SECRET);
    return typeof payload === "object" && typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    // Expired, tampered or malformed — all just "Not authenticated" (docs/06).
    return null;
  }
}
