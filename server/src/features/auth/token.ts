import jwt from "jsonwebtoken";
import { env } from "../../env";

export interface SessionPayload {
  sub: string;
}

const COOKIE_NAME = "dc_session";
const EXPIRES_IN = "7d";

export function signSession(userId: string): string {
  return jwt.sign({ sub: userId } satisfies SessionPayload, env.JWT_SECRET, {
    expiresIn: EXPIRES_IN,
  });
}

export function verifySession(token: string): SessionPayload | null {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET);
    if (typeof payload === "object" && payload !== null && "sub" in payload) {
      const sub = (payload as { sub?: unknown }).sub;
      if (typeof sub === "string") {
        return { sub };
      }
    }
    return null;
  } catch {
    return null;
  }
}

export const sessionCookie = {
  name: COOKIE_NAME,
  options: {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: env.NODE_ENV === "production",
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
};
