import rateLimit from "express-rate-limit";
import { Router, type Response } from "express";
import { HttpError, parseOrThrow } from "../../httpErrors";
import { wrapAsync } from "../../wrapAsync";
import { createUser, findUserByEmail, updatePassword } from "../users/repo";
import { toUserDto } from "../users/types";
import { requireAuth } from "./middleware";
import { hashPassword, verifyPassword } from "./password";
import { loginSchema, patchPasswordSchema, registerSchema } from "./schemas";
import { sessionCookie, signSession } from "./token";

export const authRouter = Router();

export const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ error: "Too many requests" });
  },
});

function setSession(res: Response, userId: string) {
  const token = signSession(userId);
  res.cookie(sessionCookie.name, token, sessionCookie.options);
}

function clearSession(res: Response) {
  res.clearCookie(sessionCookie.name, {
    httpOnly: sessionCookie.options.httpOnly,
    sameSite: sessionCookie.options.sameSite,
    secure: sessionCookie.options.secure,
    path: sessionCookie.options.path,
  });
}

authRouter.post(
  "/auth/register",
  wrapAsync(async (req, res) => {
    const body = parseOrThrow(registerSchema, req.body);

    try {
      const passwordHash = await hashPassword(body.password);
      const user = await createUser({
        email: body.email,
        username: body.username,
        passwordHash,
      });
      setSession(res, user.id);
      res.status(201).json({ user: toUserDto(user) });
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: string }).code === "23505"
      ) {
        const constraint = (error as { constraint?: string }).constraint ?? "";
        if (constraint.includes("email")) {
          throw new HttpError(409, "Email already registered");
        }
        if (constraint.includes("username")) {
          throw new HttpError(409, "Username already taken");
        }
        // Fallback: check both in deterministic order.
        const existingEmail = await findUserByEmail(body.email);
        if (existingEmail) {
          throw new HttpError(409, "Email already registered");
        }
        throw new HttpError(409, "Username already taken");
      }
      throw error;
    }
  }),
);

authRouter.post(
  "/auth/login",
  loginLimiter,
  wrapAsync(async (req, res) => {
    const body = parseOrThrow(loginSchema, req.body);
    const user = await findUserByEmail(body.email);
    if (!user) {
      throw new HttpError(401, "Invalid email or password");
    }
    const ok = await verifyPassword(body.password, user.password_hash);
    if (!ok) {
      throw new HttpError(401, "Invalid email or password");
    }
    setSession(res, user.id);
    res.json({ user: toUserDto(user) });
  }),
);

authRouter.post("/auth/logout", (_req, res) => {
  clearSession(res);
  res.status(204).send();
});

authRouter.get(
  "/me",
  requireAuth,
  wrapAsync(async (req, res) => {
    const user = req.authUser;
    if (!user) {
      throw new HttpError(401, "Not authenticated");
    }
    res.json({ user: toUserDto(user) });
  }),
);

authRouter.patch(
  "/me/password",
  requireAuth,
  wrapAsync(async (req, res) => {
    const body = parseOrThrow(patchPasswordSchema, req.body);
    const user = req.authUser;
    if (!user) {
      throw new HttpError(401, "Not authenticated");
    }
    const ok = await verifyPassword(body.currentPassword, user.password_hash);
    if (!ok) {
      throw new HttpError(401, "Current password is incorrect");
    }
    const passwordHash = await hashPassword(body.newPassword);
    await updatePassword(user.id, passwordHash);
    res.status(204).send();
  }),
);
