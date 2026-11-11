import type { NextFunction, Request, Response } from "express";
import { HttpError } from "../../httpError";
import { findUserById, type UserRow } from "../users/repo";
import { sessionUserId } from "./token";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: UserRow;
    }
  }
}

// Reads + verifies the dc_session cookie and attaches the user (docs/01).
// Mounted through wrapAsync: the user lookup makes it async.
export const requireAuth = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  const userId = sessionUserId(req.cookies?.dc_session);
  if (userId === null) {
    next(new HttpError(401, "Not authenticated"));
    return;
  }
  // Load the row so handlers serve fresh data; a deleted user's token is dead.
  const user = await findUserById(userId);
  if (user === null) {
    next(new HttpError(401, "Not authenticated"));
    return;
  }
  req.user = user;
  next();
};
