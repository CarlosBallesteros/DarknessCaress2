import { z } from "zod";

// Registration constraints per docs/01: email format, password min 8,
// username 3–20 chars [a-zA-Z0-9_-]. Shared by register and PATCH /api/me.
export const usernameSchema = z
  .string()
  .min(3)
  .max(20)
  .regex(/^[a-zA-Z0-9_-]+$/);

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  username: usernameSchema,
});

// Login validates the body shape; credential correctness is always the same
// 401 message (docs/06), so the password rule here is only "present".
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

// The `?` keys are optional (send any zero or more), but at least one key must
// be present (docs/06 endpoint 5).
export const patchMeSchema = z
  .object({
    username: usernameSchema.optional(),
    theme: z.string().optional(),
  })
  .refine((body) => body.username !== undefined || body.theme !== undefined, {
    message: "At least one of username or theme is required",
  });
