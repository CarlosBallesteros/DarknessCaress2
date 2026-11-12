import type { NextFunction, Request, Response } from "express";
import { HttpError } from "../../httpErrors";
import { findUserById } from "../users/repo";
import { sessionCookie, verifySession } from "./token";

export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.[sessionCookie.name];
  if (typeof token !== "string" || token.length === 0) {
    next(new HttpError(401, "Not authenticated"));
    return;
  }

  const payload = verifySession(token);
  if (!payload) {
    next(new HttpError(401, "Not authenticated"));
    return;
  }

  const user = await findUserById(payload.sub);
  if (!user) {
    next(new HttpError(401, "Not authenticated"));
    return;
  }

  req.authUser = user;
  next();
}
