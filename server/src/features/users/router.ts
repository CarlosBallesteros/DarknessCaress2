import { Router } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import type { AppConfig } from "../../config/index.js";
import { wrapAsync } from "../wrapAsync.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import type { AuthenticatedRequest } from "../auth/requireAuth.js";
import { changePasswordSchema, patchMeSchema } from "../auth/schemas.js";
import {
  findUserById,
  toPublicUser,
  updatePasswordHash,
  updateTheme,
  updateUsername,
} from "../auth/userRepo.js";

function firstZodIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Validation error";
}

export function createUsersRouter(
  pool: Pool,
  config: AppConfig,
  requireAuth: ReturnType<typeof import("../auth/requireAuth.js").createRequireAuth>,
): Router {
  const router = Router();

  router.get(
    "/me",
    requireAuth,
    wrapAsync((req, res) => {
      const { user } = req as AuthenticatedRequest;
      res.status(200).json({ user });
    }),
  );

  router.patch(
    "/me",
    requireAuth,
    wrapAsync(async (req, res) => {
      const parsed = patchMeSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: firstZodIssue(parsed.error) });
        return;
      }
      const authReq = req as AuthenticatedRequest;
      let current = await findUserById(pool, authReq.user.id);
      if (!current) {
        res.status(401).json({ error: "Not authenticated" });
        return;
      }

      const { username, theme } = parsed.data;
      if (theme !== undefined) {
        const known = config.themes.some((t) => t.id === theme);
        if (!known) {
          res.status(400).json({ error: "Unknown theme" });
          return;
        }
      }

      try {
        if (username !== undefined && username !== current.username) {
          current = await updateUsername(pool, current.id, username);
        }
        if (theme !== undefined && theme !== current.theme) {
          current = await updateTheme(pool, current.id, theme);
        }
      } catch (err) {
        const e = err as { code?: string; constraint?: string };
        if (e.code === "23505" && e.constraint === "users_username_key") {
          res.status(409).json({ error: "Username already taken" });
          return;
        }
        throw err;
      }

      res.status(200).json({ user: toPublicUser(current) });
    }),
  );

  router.patch(
    "/me/password",
    requireAuth,
    wrapAsync(async (req, res) => {
      const parsed = changePasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: firstZodIssue(parsed.error) });
        return;
      }
      const authReq = req as AuthenticatedRequest;
      const current = await findUserById(pool, authReq.user.id);
      if (!current) {
        res.status(401).json({ error: "Not authenticated" });
        return;
      }
      const ok = await verifyPassword(parsed.data.currentPassword, current.password_hash);
      if (!ok) {
        res.status(401).json({ error: "Current password is incorrect" });
        return;
      }
      const newHash = await hashPassword(parsed.data.newPassword);
      await updatePasswordHash(pool, current.id, newHash);
      res.status(204).send();
    }),
  );

  return router;
}
