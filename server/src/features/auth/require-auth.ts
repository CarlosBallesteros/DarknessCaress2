// requireAuth middleware (docs/01): reads + verifies the dc_session cookie and
// attaches the user row; missing/invalid ⇒ 401 {"error":"Not authenticated"}
// (docs/06 conventions).
import type { RequestHandler } from "express";
import { HttpError } from "../../http-error";
import { wrapAsync } from "../../wrap-async";
import { findUserById, type UserRow } from "../users/users.repo";
import { SESSION_COOKIE, verifySession } from "./jwt";

declare module "express-serve-static-core" {
  interface Request {
    user?: UserRow;
  }
}

export const requireAuth: RequestHandler = wrapAsync(
  async (req, _res, next) => {
    const token = req.cookies?.[SESSION_COOKIE];
    const payload = typeof token === "string" ? verifySession(token) : null;
    if (!payload) throw new HttpError(401, "Not authenticated");

    const user = await findUserById(payload.sub);
    if (!user) throw new HttpError(401, "Not authenticated");

    req.user = user;
    next();
  },
);
