import { Router, type RequestHandler } from "express";
import { pool } from "../../db/pool";
import { wrapAsync } from "../wrapAsync";
import { loginRateLimit } from "./loginRateLimit";
import { requireAuth } from "./middleware";
import { hashPassword, verifyPassword } from "./passwords";
import { parseBody } from "./validation";
import { loginSchema, passwordChangeSchema, registerSchema } from "./schemas";
import { clearSessionCookie, setSessionCookie } from "./session";
import { findUserByEmail, isUniqueViolation, toUserDto, type UserRow } from "./userRepo";
import "./types";

export function createAuthRouter(options?: { loginLimiter?: RequestHandler }): Router {
  const router = Router();
  const limiter = options?.loginLimiter ?? loginRateLimit;

  router.post(
    "/api/auth/register",
    wrapAsync(async (req, res) => {
      const body = parseBody(registerSchema, req.body, res);
      if (!body) return;

      const passwordHash = await hashPassword(body.password);

      try {
        const result = await pool.query<UserRow>(
          `INSERT INTO users (email, username, password_hash)
           VALUES ($1, $2, $3)
           RETURNING id, email, username, password_hash, theme, created_at`,
          [body.email, body.username, passwordHash],
        );
        const user = result.rows[0];
        if (!user) {
          res.status(500).json({ error: "Failed to create user" });
          return;
        }
        setSessionCookie(res, user.id);
        res.status(201).json({ user: toUserDto(user) });
      } catch (error) {
        if (isUniqueViolation(error)) {
          const constraint = (error as { constraint?: string }).constraint ?? "";
          if (constraint.includes("email")) {
            res.status(409).json({ error: "Email already registered" });
            return;
          }
          if (constraint.includes("username")) {
            res.status(409).json({ error: "Username already taken" });
            return;
          }
        }
        throw error;
      }
    }),
  );

  router.post(
    "/api/auth/login",
    limiter,
    wrapAsync(async (req, res) => {
      const body = parseBody(loginSchema, req.body, res);
      if (!body) return;

      const user = await findUserByEmail(body.email);
      if (!user) {
        res.status(401).json({ error: "Invalid email or password" });
        return;
      }

      const ok = await verifyPassword(body.password, user.password_hash);
      if (!ok) {
        res.status(401).json({ error: "Invalid email or password" });
        return;
      }

      setSessionCookie(res, user.id);
      res.status(200).json({ user: toUserDto(user) });
    }),
  );

  router.post(
    "/api/auth/logout",
    wrapAsync(async (_req, res) => {
      clearSessionCookie(res);
      res.status(204).send();
    }),
  );

  router.get(
    "/api/me",
    requireAuth,
    wrapAsync(async (req, res) => {
      const user = req.user;
      if (!user) {
        res.status(401).json({ error: "Not authenticated" });
        return;
      }
      res.status(200).json({ user: toUserDto(user) });
    }),
  );

  router.patch(
    "/api/me/password",
    requireAuth,
    wrapAsync(async (req, res) => {
      const user = req.user;
      if (!user) {
        res.status(401).json({ error: "Not authenticated" });
        return;
      }

      const body = parseBody(passwordChangeSchema, req.body, res);
      if (!body) return;

      const ok = await verifyPassword(body.currentPassword, user.password_hash);
      if (!ok) {
        res.status(401).json({ error: "Current password is incorrect" });
        return;
      }

      const newHash = await hashPassword(body.newPassword);
      await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [newHash, user.id]);
      res.status(204).send();
    }),
  );

  return router;
}

export const authRouter = createAuthRouter();

authRouter.post(
  "/api/auth/register",
  wrapAsync(async (req, res) => {
    const body = parseBody(registerSchema, req.body, res);
    if (!body) return;

    const passwordHash = await hashPassword(body.password);

    try {
      const result = await pool.query<UserRow>(
        `INSERT INTO users (email, username, password_hash)
         VALUES ($1, $2, $3)
         RETURNING id, email, username, password_hash, theme, created_at`,
        [body.email, body.username, passwordHash],
      );
      const user = result.rows[0];
      if (!user) {
        res.status(500).json({ error: "Failed to create user" });
        return;
      }
      setSessionCookie(res, user.id);
      res.status(201).json({ user: toUserDto(user) });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const constraint = (error as { constraint?: string }).constraint ?? "";
        if (constraint.includes("email")) {
          res.status(409).json({ error: "Email already registered" });
          return;
        }
        if (constraint.includes("username")) {
          res.status(409).json({ error: "Username already taken" });
          return;
        }
      }
      throw error;
    }
  }),
);

authRouter.post(
  "/api/auth/login",
  loginRateLimit,
  wrapAsync(async (req, res) => {
    const body = parseBody(loginSchema, req.body, res);
    if (!body) return;

    const user = await findUserByEmail(body.email);
    if (!user) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    const ok = await verifyPassword(body.password, user.password_hash);
    if (!ok) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    setSessionCookie(res, user.id);
    res.status(200).json({ user: toUserDto(user) });
  }),
);

authRouter.post(
  "/api/auth/logout",
  wrapAsync(async (_req, res) => {
    clearSessionCookie(res);
    res.status(204).send();
  }),
);

authRouter.get(
  "/api/me",
  requireAuth,
  wrapAsync(async (req, res) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    res.status(200).json({ user: toUserDto(user) });
  }),
);

authRouter.patch(
  "/api/me/password",
  requireAuth,
  wrapAsync(async (req, res) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    const body = parseBody(passwordChangeSchema, req.body, res);
    if (!body) return;

    const ok = await verifyPassword(body.currentPassword, user.password_hash);
    if (!ok) {
      res.status(401).json({ error: "Current password is incorrect" });
      return;
    }

    const newHash = await hashPassword(body.newPassword);
    await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [newHash, user.id]);
    res.status(204).send();
  }),
);
