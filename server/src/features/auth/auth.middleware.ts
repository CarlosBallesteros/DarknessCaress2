import type { RequestHandler } from "express";
import { wrapAsync } from "../../wrap-async.js";
import type { UserRow } from "../users/user.dto.js";
import { findUserById } from "../users/users.queries.js";
import { SESSION_COOKIE, verifySessionToken } from "./auth.tokens.js";

declare module "express-serve-static-core" {
  interface Request {
    user?: UserRow;
  }
}

/**
 * Reads+verifies the dc_session cookie and attaches the user row (01).
 * Unknown user (e.g. deleted after the token was issued) is also 401.
 */
export const requireAuth: RequestHandler = wrapAsync(async (req, res, next) => {
  const token = req.cookies?.[SESSION_COOKIE];
  const userId = typeof token === "string" ? verifySessionToken(token) : null;
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const user = await findUserById(userId);
  if (!user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  req.user = user;
  next();
});
