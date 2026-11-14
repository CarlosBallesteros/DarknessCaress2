import { Router } from "express";
import { getPool } from "../../db/pool.js";
import { getConfig } from "../../config/index.js";
import { wrapAsync } from "../wrapAsync.js";
import {
  changePasswordSchema,
  firstZodError,
  hashPassword,
  patchMeSchema,
  requireAuth,
  toPublicUser,
  verifyPassword,
} from "../auth/core.js";

export const usersRouter = Router();

usersRouter.get(
  "/me",
  requireAuth,
  wrapAsync((req, res) => {
    res.status(200).json({ user: toPublicUser(req.authUser!) });
  }),
);

usersRouter.patch(
  "/me",
  requireAuth,
  wrapAsync(async (req, res) => {
    const parsed = patchMeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstZodError(parsed.error) });
      return;
    }
    const { username, theme } = parsed.data;
    const pool = getPool();

    if (theme !== undefined) {
      const config = getConfig();
      const known = config.themes.some((t) => t.id === theme);
      if (!known) {
        res.status(400).json({ error: "Unknown theme" });
        return;
      }
    }

    if (username !== undefined) {
      const dup = await pool.query("SELECT id FROM users WHERE username = $1 AND id <> $2", [
        username,
        req.authUser!.id,
      ]);
      if (dup.rows.length > 0) {
        res.status(409).json({ error: "Username already taken" });
        return;
      }
    }

    const updates: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    if (username !== undefined) {
      updates.push(`username = $${idx++}`);
      values.push(username);
    }
    if (theme !== undefined) {
      updates.push(`theme = $${idx++}`);
      values.push(theme);
    }
    values.push(req.authUser!.id);

    const result = await pool.query(
      `UPDATE users SET ${updates.join(", ")} WHERE id = $${idx} RETURNING id, email, username, password_hash, theme, created_at`,
      values,
    );
    res.status(200).json({ user: toPublicUser(result.rows[0]) });
  }),
);

usersRouter.patch(
  "/me/password",
  requireAuth,
  wrapAsync(async (req, res) => {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstZodError(parsed.error) });
      return;
    }
    const { currentPassword, newPassword } = parsed.data;
    const ok = await verifyPassword(currentPassword, req.authUser!.password_hash);
    if (!ok) {
      res.status(401).json({ error: "Current password is incorrect" });
      return;
    }
    const pool = getPool();
    const passwordHash = await hashPassword(newPassword);
    await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [
      passwordHash,
      req.authUser!.id,
    ]);
    res.status(204).send();
  }),
);
