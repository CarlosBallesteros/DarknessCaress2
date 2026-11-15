import { Router } from "express";
import rateLimit from "express-rate-limit";
import type { Pool } from "pg";
import { z } from "zod";
import { wrapAsync } from "../wrapAsync.js";
import { getSessionCookieName, getSessionCookieOptions, signSessionToken } from "./jwt.js";
import { hashPassword, verifyPassword } from "./password.js";
import { loginSchema, registerSchema } from "./schemas.js";
import { createUser, findUserByEmail, toPublicUser } from "./userRepo.js";

function firstZodIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Validation error";
}

export function createAuthRouter(pool: Pool, jwtSecret: string): Router {
  const router = Router();

  const loginLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({ error: "Too many requests" });
    },
  });

  router.post(
    "/auth/register",
    wrapAsync(async (req, res) => {
      const parsed = registerSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: firstZodIssue(parsed.error) });
        return;
      }
      const { email, username, password } = parsed.data;
      const passwordHash = await hashPassword(password);
      try {
        const user = await createUser(pool, { email, username, passwordHash });
        const token = signSessionToken(user.id, jwtSecret);
        res.cookie(getSessionCookieName(), token, getSessionCookieOptions());
        res.status(201).json({ user: toPublicUser(user) });
      } catch (err) {
        const e = err as { code?: string; constraint?: string };
        if (e.code === "23505") {
          if (e.constraint === "users_email_key") {
            res.status(409).json({ error: "Email already registered" });
            return;
          }
          if (e.constraint === "users_username_key") {
            res.status(409).json({ error: "Username already taken" });
            return;
          }
        }
        throw err;
      }
    }),
  );

  router.post(
    "/auth/login",
    loginLimiter,
    wrapAsync(async (req, res) => {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: firstZodIssue(parsed.error) });
        return;
      }
      const { email, password } = parsed.data;
      const user = await findUserByEmail(pool, email);
      if (!user) {
        res.status(401).json({ error: "Invalid email or password" });
        return;
      }
      const ok = await verifyPassword(password, user.password_hash);
      if (!ok) {
        res.status(401).json({ error: "Invalid email or password" });
        return;
      }
      const token = signSessionToken(user.id, jwtSecret);
      res.cookie(getSessionCookieName(), token, getSessionCookieOptions());
      res.status(200).json({ user: toPublicUser(user) });
    }),
  );

  router.post(
    "/auth/logout",
    wrapAsync((_req, res) => {
      res.clearCookie(getSessionCookieName(), {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
      });
      res.status(204).send();
    }),
  );

  return router;
}
