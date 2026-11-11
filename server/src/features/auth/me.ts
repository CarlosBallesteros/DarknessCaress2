import type { Request, Response } from "express";
import { HttpError } from "../../httpError";
import { toUserDto } from "../users/repo";

// GET /api/me — current user (docs/06 endpoint 4). requireAuth attaches req.user.
export async function me(req: Request, res: Response): Promise<void> {
  const user = req.user;
  if (!user) {
    throw new HttpError(401, "Not authenticated");
  }
  res.status(200).json({ user: toUserDto(user) });
}
