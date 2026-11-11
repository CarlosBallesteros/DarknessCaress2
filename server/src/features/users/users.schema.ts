// Profile update validation (docs/06 endpoints 5–6). PATCH /api/me takes ANY
// ZERO OR MORE of username/theme — at least one key must be present.
import { z } from "zod";

export const patchMeSchema = z
  .object({
    username: z
      .string()
      .min(3)
      .max(20)
      .regex(/^[a-zA-Z0-9_-]+$/)
      .optional(),
    theme: z.string().min(1).optional(),
  })
  .refine(
    (body) => body.username !== undefined || body.theme !== undefined,
    "Provide at least one of username or theme",
  );

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});
