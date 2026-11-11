// Input validation for auth (docs/01 Auth mechanics + docs/06 endpoints 1–2):
// email format, password min 8, username 3–20 chars [a-zA-Z0-9_-].
import { z } from "zod";

export const registerSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
  username: z
    .string()
    .min(3)
    .max(20)
    .regex(/^[a-zA-Z0-9_-]+$/),
});

// A login attempt is any credential pair: only emptiness is a shape error, so
// wrong passwords keep the contract's single 401 message (docs/06 endpoint 2).
export const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});
