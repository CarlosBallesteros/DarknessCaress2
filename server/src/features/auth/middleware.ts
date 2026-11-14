import type { NextFunction, Request, Response } from "express";
import { wrapAsync } from "../wrapAsync";
import { readSessionToken, verifySession } from "./session";
import { findUserById } from "./userRepo";
import "./types";

export const requireAuth = wrapAsync(async (req: Request, res: Response, next: NextFunction) => {
  const token = readSessionToken(req);
  if (!token) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  try {
    const payload = verifySession(token);
    const user = await findUserById(payload.sub);
    if (!user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: "Not authenticated" });
  }
});
