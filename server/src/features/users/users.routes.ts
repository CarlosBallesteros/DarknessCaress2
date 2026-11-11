// Users endpoints 4–6 (docs/06): GET /api/me, PATCH /api/me, PATCH
// /api/me/password — all require the session cookie.
import { Router } from "express";
import { HttpError, parseBody } from "../../http-error";
import { wrapAsync } from "../../wrap-async";
import { config } from "../../config/config";
import { hashPassword, verifyPassword } from "../auth/password";
import { requireAuth } from "../auth/require-auth";
import {
  findUserByUsername,
  toUserDto,
  updateUser,
  updateUserPassword,
} from "./users.repo";
import { changePasswordSchema, patchMeSchema } from "./users.schema";

export const usersRouter = Router();

usersRouter.use(requireAuth);

// 4. GET /api/me → 200 {"user": User}
usersRouter.get(
  "/",
  wrapAsync(async (req, res) => {
    res.status(200).json({ user: toUserDto(req.user!) });
  }),
);

// 5. PATCH /api/me — username and/or theme → 200 {"user": User}
usersRouter.patch(
  "/",
  wrapAsync(async (req, res) => {
    const patch = parseBody(patchMeSchema, req.body);

    if (
      patch.theme !== undefined &&
      !config.themes.some((theme) => theme.id === patch.theme)
    ) {
      throw new HttpError(400, "Unknown theme");
    }
    if (patch.username !== undefined) {
      const existing = await findUserByUsername(patch.username);
      if (existing && existing.id !== req.user!.id) {
        throw new HttpError(409, "Username already taken");
      }
    }

    const updated = await updateUser(req.user!.id, patch);
    res.status(200).json({ user: toUserDto(updated) });
  }),
);

// 6. PATCH /api/me/password → 204; other sessions stay valid (no revocation
//    machinery in MVP).
usersRouter.patch(
  "/password",
  wrapAsync(async (req, res) => {
    const { currentPassword, newPassword } = parseBody(
      changePasswordSchema,
      req.body,
    );

    if (!(await verifyPassword(currentPassword, req.user!.password_hash))) {
      throw new HttpError(401, "Current password is incorrect");
    }

    await updateUserPassword(req.user!.id, await hashPassword(newPassword));
    res.status(204).send();
  }),
);
