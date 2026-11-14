import { Router } from "express";
import { getPool } from "../../db/pool.js";
import { wrapAsync } from "../wrapAsync.js";
import {
  clearSessionCookie,
  createLoginRateLimiter,
  findUserByEmail,
  firstZodError,
  hashPassword,
  loginSchema,
  registerSchema,
  setSessionCookie,
  toPublicUser,
  verifyPassword,
} from "./core.js";

export function createAuthRouter(): Router {
  const authRouter = Router();
  const loginRateLimiter = createLoginRateLimiter();

  authRouter.post(
    "/register",
    wrapAsync(async (req, res) => {
      const parsed = registerSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: firstZodError(parsed.error) });
        return;
      }
      const { email, password, username } = parsed.data;
      const pool = getPool();
      const existing = await pool.query(
        "SELECT id, lower(email::text) AS email_lc, lower(username::text) AS username_lc FROM users WHERE email = $1 OR username = $2",
        [email, username],
      );
      const dupEmail = existing.rows.find((row) => row.email_lc === email.toLowerCase());
      if (dupEmail) {
        res.status(409).json({ error: "Email already registered" });
        return;
      }
      const dupUsername = existing.rows.find((row) => row.username_lc === username.toLowerCase());
      if (dupUsername) {
        res.status(409).json({ error: "Username already taken" });
        return;
      }

      const passwordHash = await hashPassword(password);
      const inserted = await pool.query(
        "INSERT INTO users (email, username, password_hash) VALUES ($1, $2, $3) RETURNING id, email, username, password_hash, theme, created_at",
        [email, username, passwordHash],
      );
      const user = inserted.rows[0];
      setSessionCookie(res, user.id);
      res.status(201).json({ user: toPublicUser(user) });
    }),
  );

  authRouter.post(
    "/login",
    loginRateLimiter,
    wrapAsync(async (req, res) => {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: firstZodError(parsed.error) });
        return;
      }
      const { email, password } = parsed.data;
      const user = await findUserByEmail(email);
      if (!user) {
        res.status(401).json({ error: "Invalid email or password" });
        return;
      }
      const ok = await verifyPassword(password, user.password_hash);
      if (!ok) {
        res.status(401).json({ error: "Invalid email or password" });
        return;
      }
      setSessionCookie(res, user.id);
      res.status(200).json({ user: toPublicUser(user) });
    }),
  );

  authRouter.post("/logout", (_req, res) => {
    clearSessionCookie(res);
    res.status(204).send();
  });

  return authRouter;
}
