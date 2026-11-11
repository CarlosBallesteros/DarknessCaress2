import { Router } from "express";
import { wrapAsync } from "../../wrapAsync";
import { requireAuth } from "../auth/requireAuth";
import { patchMe } from "./patchMe";

// Mounted at /api. Profile updates per docs/01's layout (auth holds the
// middleware and the session endpoints; this feature holds profile updates).
export const usersRouter = Router();

usersRouter.patch("/me", wrapAsync(requireAuth), wrapAsync(patchMe));
