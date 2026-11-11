import type { Request, Response } from "express";
import bcrypt from "bcrypt";
import { HttpError } from "../../httpError";
import { parseBody } from "../../validation";
import { findUserByEmail, findUserByUsername, insertUser, toUserDto } from "../users/repo";
import { registerSchema } from "./schemas";
import { setSessionCookie } from "./token";

// POST /api/auth/register — 201 {"user"} + session cookie (docs/06 endpoint 1).
export async function register(req: Request, res: Response): Promise<void> {
  const body = parseBody(registerSchema, req.body);
  if ((await findUserByEmail(body.email)) !== null) {
    throw new HttpError(409, "Email already registered");
  }
  if ((await findUserByUsername(body.username)) !== null) {
    throw new HttpError(409, "Username already taken");
  }
  // bcrypt cost 10 per docs/01 (an auth mechanic, not a game tunable).
  const passwordHash = await bcrypt.hash(body.password, 10);
  const user = await insertUser(body.email, body.username, passwordHash);
  setSessionCookie(res, user.id);
  res.status(201).json({ user: toUserDto(user) });
}
