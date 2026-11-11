import type { Request, Response } from "express";
import { clearSessionCookie } from "./token";

// POST /api/auth/logout — deliberately exempt from auth: always succeeds, even
// with no session (docs/06 endpoint 3).
export async function logout(_req: Request, res: Response): Promise<void> {
  clearSessionCookie(res);
  res.status(204).end();
}
