import type { Request, Response } from "express";
import bcrypt from "bcrypt";
import { HttpError } from "../../httpError";
import { parseBody } from "../../validation";
import { findUserByEmail, toUserDto } from "../users/repo";
import { loginSchema } from "./schemas";
import { setSessionCookie } from "./token";

// POST /api/auth/login — 200 {"user"} + cookie; unknown email and wrong
// password share one message so the error never reveals which failed (docs/06).
export async function login(req: Request, res: Response): Promise<void> {
  const body = parseBody(loginSchema, req.body);
  const user = await findUserByEmail(body.email);
  if (user === null || !(await bcrypt.compare(body.password, user.password_hash))) {
    throw new HttpError(401, "Invalid email or password");
  }
  setSessionCookie(res, user.id);
  res.status(200).json({ user: toUserDto(user) });
}
