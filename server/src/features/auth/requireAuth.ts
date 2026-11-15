import type { NextFunction, Request, Response } from "express";
import type { Pool } from "pg";
import { getSessionCookieName, verifySessionToken } from "./jwt.js";
import { findUserById, type PublicUser, toPublicUser } from "./userRepo.js";

export interface AuthenticatedRequest extends Request {
  user: PublicUser;
}

export function createRequireAuth(pool: Pool, jwtSecret: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const token = req.cookies?.[getSessionCookieName()];
    if (typeof token !== "string" || token.length === 0) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const payload = verifySessionToken(token, jwtSecret);
    if (!payload) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const user = await findUserById(pool, payload.sub);
    if (!user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    (req as AuthenticatedRequest).user = toPublicUser(user);
    next();
  };
}
