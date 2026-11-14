import type { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../../env";

export const SESSION_COOKIE = "dc_session";
const SESSION_TTL = "7d";

export interface SessionPayload {
  sub: string;
}

export function signSession(userId: string): string {
  return jwt.sign({ sub: userId } satisfies SessionPayload, env.JWT_SECRET, {
    expiresIn: SESSION_TTL,
  });
}

export function verifySession(token: string): SessionPayload {
  const payload = jwt.verify(token, env.JWT_SECRET);
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("sub" in payload) ||
    typeof payload.sub !== "string"
  ) {
    throw new Error("Invalid session payload");
  }
  return { sub: payload.sub };
}

export function setSessionCookie(res: Response, userId: string): void {
  const token = signSession(userId);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
  });
}

export function readSessionToken(req: Request): string | undefined {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const token = cookies?.[SESSION_COOKIE];
  return typeof token === "string" ? token : undefined;
}
