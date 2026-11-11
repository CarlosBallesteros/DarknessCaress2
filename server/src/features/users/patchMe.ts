import type { Request, Response } from "express";
import { config } from "../../config/load";
import { HttpError } from "../../httpError";
import { parseBody } from "../../validation";
import { findUserByUsername, toUserDto, updateUser } from "./repo";
import { patchMeSchema } from "../auth/schemas";

// PATCH /api/me — optional keys username/theme, at least one must be present
// (docs/06 endpoint 5). The username zod rules live with the auth schemas
// (same constraints as registration); theme existence is checked here against
// the config, as the contract mandates its own exact error body.
export async function patchMe(req: Request, res: Response): Promise<void> {
  const user = req.user;
  if (!user) {
    throw new HttpError(401, "Not authenticated");
  }
  const body = parseBody(patchMeSchema, req.body);
  if (body.theme !== undefined && !config.themes.some((theme) => theme.id === body.theme)) {
    throw new HttpError(400, "Unknown theme");
  }
  if (body.username !== undefined) {
    const taken = await findUserByUsername(body.username);
    // CITEXT uniqueness is case-insensitive; taking your own name is a no-op, not a conflict.
    if (taken !== null && taken.id !== user.id) {
      throw new HttpError(409, "Username already taken");
    }
  }
  const updated = await updateUser(user.id, body);
  res.status(200).json({ user: toUserDto(updated) });
}
