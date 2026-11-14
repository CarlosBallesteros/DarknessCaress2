import { Router } from "express";
import { config } from "../../config";
import { pool } from "../../db/pool";
import { requireAuth } from "../auth/middleware";
import { parseBody } from "../auth/validation";
import { wrapAsync } from "../wrapAsync";
import { isUniqueViolation, toUserDto, type UserRow } from "../auth/userRepo";
import { patchMeSchema } from "./schemas";
import "../auth/types";

export const usersRouter = Router();

usersRouter.patch(
  "/api/me",
  requireAuth,
  wrapAsync(async (req, res) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    const body = parseBody(patchMeSchema, req.body, res);
    if (!body) return;

    if (body.theme !== undefined) {
      const known = config.themes.some((theme) => theme.id === body.theme);
      if (!known) {
        res.status(400).json({ error: "Unknown theme" });
        return;
      }
    }

    const nextUsername = body.username ?? user.username;
    const nextTheme = body.theme ?? user.theme;

    try {
      const result = await pool.query<UserRow>(
        `UPDATE users
         SET username = $1, theme = $2
         WHERE id = $3
         RETURNING id, email, username, password_hash, theme, created_at`,
        [nextUsername, nextTheme, user.id],
      );
      const updated = result.rows[0];
      if (!updated) {
        res.status(401).json({ error: "Not authenticated" });
        return;
      }
      res.status(200).json({ user: toUserDto(updated) });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const constraint = (error as { constraint?: string }).constraint ?? "";
        if (constraint.includes("username")) {
          res.status(409).json({ error: "Username already taken" });
          return;
        }
      }
      throw error;
    }
  }),
);
