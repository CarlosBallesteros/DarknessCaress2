// Auth endpoints 1–3 (docs/06): register, login, logout. Login is rate-limited
// to 10 requests/min/IP (docs/01, in-memory express-rate-limit). The router is
// a factory so each app instance owns its own in-memory limiter store.
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { HttpError, parseBody } from "../../http-error";
import { wrapAsync } from "../../wrap-async";
import {
  createUser,
  findUserByEmail,
  findUserByUsername,
  toUserDto,
} from "../users/users.repo";
import { registerSchema, loginSchema } from "./auth.schema";
import { clearSessionCookie, setSessionCookie, signSession } from "./jwt";
import { hashPassword, verifyPassword } from "./password";

export function createAuthRouter(): Router {
  const loginLimiter = rateLimit({
    windowMs: 60_000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
      res
        .status(429)
        .json({ error: "Too many requests, please try again later." });
    },
  });

  const router = Router();

  // 1. POST /api/auth/register → 201 {"user": User} + session cookie
  router.post(
    "/register",
    wrapAsync(async (req, res) => {
      const input = parseBody(registerSchema, req.body);

      if (await findUserByEmail(input.email)) {
        throw new HttpError(409, "Email already registered");
      }
      if (await findUserByUsername(input.username)) {
        throw new HttpError(409, "Username already taken");
      }

      const user = await createUser({
        email: input.email,
        username: input.username,
        passwordHash: await hashPassword(input.password),
      });

      setSessionCookie(res, signSession(user.id));
      res.status(201).json({ user: toUserDto(user) });
    }),
  );

  // 2. POST /api/auth/login → 200 {"user": User} + cookie;
  //    401 with the SAME message for unknown email and wrong password.
  router.post(
    "/login",
    loginLimiter,
    wrapAsync(async (req, res) => {
      const input = parseBody(loginSchema, req.body);

      const user = await findUserByEmail(input.email);
      if (
        !user ||
        !(await verifyPassword(input.password, user.password_hash))
      ) {
        throw new HttpError(401, "Invalid email or password");
      }

      setSessionCookie(res, signSession(user.id));
      res.status(200).json({ user: toUserDto(user) });
    }),
  );

  // 3. POST /api/auth/logout → 204; deliberately unauthenticated — it must
  //    always succeed, even with no session (docs/06 conventions).
  router.post("/logout", (_req, res) => {
    clearSessionCookie(res);
    res.status(204).send();
  });

  return router;
}
