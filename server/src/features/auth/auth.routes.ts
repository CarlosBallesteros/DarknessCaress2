import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { wrapAsync } from "../../wrap-async.js";
import { parseBody } from "../../parse-body.js";
import { toUserDTO } from "../users/user.dto.js";
import { findUserByUsername } from "../users/users.queries.js";
import {
  findUserByEmail,
  insertUser,
  uniqueViolationColumn,
} from "./auth.queries.js";
import { hashPassword, verifyPassword } from "./password.js";
import { SESSION_COOKIE, setSessionCookie } from "./auth.tokens.js";

// 06: username 3-20, [a-zA-Z0-9_-]; password >= 8; email format (01).
const USERNAME_PATTERN = /^[a-zA-Z0-9_-]{3,20}$/;

const registerSchema = z.object({
  email: z.string().email({ message: "A valid email is required" }),
  password: z
    .string()
    .min(8, { message: "Password must be at least 8 characters" }),
  username: z.string().regex(USERNAME_PATTERN, {
    message:
      "Username must be 3-20 characters and only use letters, digits, '-' or '_'",
  }),
});

const loginSchema = z.object({
  email: z.string().email({ message: "A valid email is required" }),
  password: z.string().min(1, { message: "Password is required" }),
});

// 01: express-rate-limit (in-memory), max 10 requests/min/IP on /api/auth/login.
const loginRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
});

export const authRouter = Router();

authRouter.post(
  "/register",
  wrapAsync(async (req, res) => {
    const body = parseBody(registerSchema, req.body, res);
    if (!body) return;

    // Pre-insert checks give the precise 409 bodies from 06; the unique
    // violation catch below only covers the race in between.
    if (await findUserByEmail(body.email)) {
      res.status(409).json({ error: "Email already registered" });
      return;
    }
    if (await findUserByUsername(body.username)) {
      res.status(409).json({ error: "Username already taken" });
      return;
    }

    const passwordHash = await hashPassword(body.password);
    let user;
    try {
      user = await insertUser({
        email: body.email,
        username: body.username,
        passwordHash,
      });
    } catch (err) {
      const violated = uniqueViolationColumn(err);
      if (violated === "email") {
        res.status(409).json({ error: "Email already registered" });
        return;
      }
      if (violated === "username") {
        res.status(409).json({ error: "Username already taken" });
        return;
      }
      throw err;
    }

    setSessionCookie(res, user.id);
    res.status(201).json({ user: toUserDTO(user) });
  }),
);

authRouter.post(
  "/login",
  loginRateLimit,
  wrapAsync(async (req, res) => {
    const body = parseBody(loginSchema, req.body, res);
    if (!body) return;

    const user = await findUserByEmail(body.email);
    if (!user || !(await verifyPassword(body.password, user.password_hash))) {
      // Same message for unknown email and wrong password (06).
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    setSessionCookie(res, user.id);
    res.status(200).json({ user: toUserDTO(user) });
  }),
);

// Deliberately exempt from auth: logout must always succeed (06).
authRouter.post(
  "/logout",
  wrapAsync(async (_req, res) => {
    res.clearCookie(SESSION_COOKIE);
    res.status(204).end();
  }),
);
