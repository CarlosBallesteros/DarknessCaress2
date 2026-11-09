import { Router } from "express";
import { z } from "zod";
import { getConfig } from "../../config/config.js";
import { wrapAsync } from "../../wrap-async.js";
import { parseBody } from "../../parse-body.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { verifyPassword, hashPassword } from "../auth/password.js";
import { toUserDTO } from "./user.dto.js";
import {
  findUserByUsername,
  updateUserPassword,
  updateUserProfile,
} from "./users.queries.js";

const USERNAME_PATTERN = /^[a-zA-Z0-9_-]{3,20}$/;

const patchMeSchema = z
  .object({
    username: z
      .string()
      .regex(USERNAME_PATTERN, {
        message:
          "Username must be 3-20 characters and only use letters, digits, '-' or '_'",
      })
      .optional(),
    theme: z.string().optional(),
  })
  .refine((body) => body.username !== undefined || body.theme !== undefined, {
    message: "At least one of username or theme is required",
  });

const changePasswordSchema = z.object({
  currentPassword: z
    .string()
    .min(1, { message: "Current password is required" }),
  newPassword: z
    .string()
    .min(8, { message: "Password must be at least 8 characters" }),
});

export const usersRouter = Router();

usersRouter.get(
  "/me",
  requireAuth,
  wrapAsync(async (req, res) => {
    res.status(200).json({ user: toUserDTO(req.user!) });
  }),
);

usersRouter.patch(
  "/me",
  requireAuth,
  wrapAsync(async (req, res) => {
    const body = parseBody(patchMeSchema, req.body, res);
    if (!body) return;
    const current = req.user!;

    if (body.theme !== undefined) {
      const known = getConfig().themes.some((theme) => theme.id === body.theme);
      if (!known) {
        res.status(400).json({ error: "Unknown theme" });
        return;
      }
    }
    if (
      body.username !== undefined &&
      (await findUserByUsername(body.username, current.id))
    ) {
      res.status(409).json({ error: "Username already taken" });
      return;
    }

    const updated = await updateUserProfile(current.id, {
      username: body.username ?? current.username,
      theme: body.theme ?? current.theme,
    });
    res.status(200).json({ user: toUserDTO(updated) });
  }),
);

usersRouter.patch(
  "/me/password",
  requireAuth,
  wrapAsync(async (req, res) => {
    const body = parseBody(changePasswordSchema, req.body, res);
    if (!body) return;
    const current = req.user!;

    if (!(await verifyPassword(body.currentPassword, current.password_hash))) {
      res.status(401).json({ error: "Current password is incorrect" });
      return;
    }
    await updateUserPassword(current.id, await hashPassword(body.newPassword));
    // Other sessions stay valid — no revocation machinery in MVP (06).
    res.status(204).end();
  }),
);
