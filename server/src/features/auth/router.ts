import { Router } from "express";
import { wrapAsync } from "../../wrapAsync";
import { loginLimiter } from "./rateLimit";
import { requireAuth } from "./requireAuth";
import { changePassword } from "./password";
import { login } from "./login";
import { logout } from "./logout";
import { me } from "./me";
import { register } from "./register";

// Mounted at /api. Endpoint paths per docs/06: /api/auth/{register,login,logout},
// GET /api/me, PATCH /api/me/password.
export const authRouter = Router();

authRouter.post("/auth/register", wrapAsync(register));
authRouter.post("/auth/login", loginLimiter, wrapAsync(login));
authRouter.post("/auth/logout", wrapAsync(logout));
authRouter.get("/me", wrapAsync(requireAuth), wrapAsync(me));
authRouter.patch("/me/password", wrapAsync(requireAuth), wrapAsync(changePassword));
