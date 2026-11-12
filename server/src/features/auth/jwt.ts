import jwt from "jsonwebtoken";

const SESSION_COOKIE = "dc_session";
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface SessionPayload {
  sub: string;
}

export function getSessionCookieName(): string {
  return SESSION_COOKIE;
}

export function getSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_MAX_AGE_MS,
  };
}

export function signSessionToken(userId: string, secret: string): string {
  return jwt.sign({ sub: userId } satisfies SessionPayload, secret, {
    expiresIn: "7d",
  });
}

export function verifySessionToken(token: string, secret: string): SessionPayload | null {
  try {
    const payload = jwt.verify(token, secret);
    if (
      typeof payload === "object" &&
      payload !== null &&
      "sub" in payload &&
      typeof payload.sub === "string"
    ) {
      return { sub: payload.sub };
    }
    return null;
  } catch {
    return null;
  }
}
