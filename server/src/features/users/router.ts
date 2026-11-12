import { Router } from "express";
import config from "../../config/config.json";
import { HttpError, parseOrThrow } from "../../httpErrors";
import { wrapAsync } from "../../wrapAsync";
import { requireAuth } from "../auth/middleware";
import { updateUserProfile } from "./repo";
import { patchMeSchema } from "./schemas";
import { toUserDto } from "./types";

export const usersRouter = Router();

usersRouter.patch(
  "/",
  requireAuth,
  wrapAsync(async (req, res) => {
    const body = parseOrThrow(patchMeSchema, req.body);
    const user = req.authUser;
    if (!user) {
      throw new HttpError(401, "Not authenticated");
    }

    if (body.theme !== undefined) {
      const known = (config.themes as Array<{ id: string }>).some(
        (theme) => theme.id === body.theme,
      );
      if (!known) {
        throw new HttpError(400, "Unknown theme");
      }
    }

    try {
      const updated = await updateUserProfile(user.id, {
        username: body.username,
        theme: body.theme,
      });
      if (!updated) {
        throw new HttpError(401, "Not authenticated");
      }
      res.json({ user: toUserDto(updated) });
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: string }).code === "23505"
      ) {
        throw new HttpError(409, "Username already taken");
      }
      throw error;
    }
  }),
);
