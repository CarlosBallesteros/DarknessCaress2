import type { RequestHandler, Response } from "express";
import bcrypt from "bcrypt";
import jwt, { type SignOptions } from "jsonwebtoken";
import { rateLimit, type RateLimitRequestHandler } from "express-rate-limit";
import { z } from "zod";
import { loadEnv } from "../../env.js";
import { getPool } from "../../db/pool.js";
import { wrapAsync } from "../wrapAsync.js";

export const BCRYPT_COST = 10;
export const SESSION_COOKIE = "dc_session";

export type AuthUser = {
  id: string;
  email: string;
  username: string;
  theme: string;
  createdAt: string;
};

export type UserRow = {
  id: string;
  email: string;
  username: string;
  password_hash: string;
  theme: string;
  created_at: Date | string;
};

export function toPublicUser(row: UserRow): AuthUser {
  const createdAt =
    row.created_at instanceof Date
      ? row.created_at.toISOString()
      : new Date(row.created_at).toISOString();
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    theme: row.theme,
    createdAt,
  };
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signSession(userId: string, expiresIn: SignOptions["expiresIn"] = "7d"): string {
  const env = loadEnv();
  return jwt.sign({ sub: userId }, env.JWT_SECRET, { expiresIn });
}

export function verifySessionToken(token: string): { sub: string } | null {
  const env = loadEnv();
  try {
    const payload = jwt.verify(token, env.JWT_SECRET);
    if (typeof payload !== "object" || payload === null || typeof payload.sub !== "string") {
      return null;
    }
    return { sub: payload.sub };
  } catch {
    return null;
  }
}

export function setSessionCookie(res: Response, userId: string): void {
  const token = signSession(userId);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
}

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  username: z
    .string()
    .min(3)
    .max(20)
    .regex(/^[a-zA-Z0-9_-]+$/),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export const patchMeSchema = z
  .object({
    username: z
      .string()
      .min(3)
      .max(20)
      .regex(/^[a-zA-Z0-9_-]+$/)
      .optional(),
    theme: z.string().optional(),
  })
  .refine((value) => value.username !== undefined || value.theme !== undefined, {
    message: "At least one field must be provided",
  });

export const changePasswordSchema = z.object({
  currentPassword: z.string(),
  newPassword: z.string().min(8),
});

export function firstZodError(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid request";
}

export function createLoginRateLimiter(): RateLimitRequestHandler {
  return rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({ error: "Too many requests" });
    },
  });
}

export const requireAuth: RequestHandler = wrapAsync(async (req, res, next) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (typeof token !== "string" || token.length === 0) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const payload = verifySessionToken(token);
  if (!payload) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const pool = getPool();
  const result = await pool.query<UserRow>(
    "SELECT id, email, username, password_hash, theme, created_at FROM users WHERE id = $1",
    [payload.sub],
  );
  const row = result.rows[0];
  if (!row) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  req.authUser = row;
  next();
});

declare module "express-serve-static-core" {
  interface Request {
    authUser?: UserRow;
  }
}

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const pool = getPool();
  const result = await pool.query<UserRow>(
    "SELECT id, email, username, password_hash, theme, created_at FROM users WHERE email = $1",
    [email],
  );
  return result.rows[0] ?? null;
}
