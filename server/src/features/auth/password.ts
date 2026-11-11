import type { Request, Response } from "express";
import bcrypt from "bcrypt";
import { HttpError } from "../../httpError";
import { parseBody } from "../../validation";
import { updatePasswordHash } from "../users/repo";
import { passwordChangeSchema } from "./schemas";

// PATCH /api/me/password — 204; wrong current password is a 401 with its own
// message, and other sessions stay valid (no revocation in MVP, docs/06).
export async function changePassword(req: Request, res: Response): Promise<void> {
  const user = req.user;
  if (!user) {
    throw new HttpError(401, "Not authenticated");
  }
  const body = parseBody(passwordChangeSchema, req.body);
  if (!(await bcrypt.compare(body.currentPassword, user.password_hash))) {
    throw new HttpError(401, "Current password is incorrect");
  }
  // bcrypt cost 10 per docs/01 (an auth mechanic, not a game tunable).
  await updatePasswordHash(user.id, await bcrypt.hash(body.newPassword, 10));
  res.status(204).end();
}
