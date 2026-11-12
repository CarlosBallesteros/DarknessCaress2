import { z } from "zod";

const usernameSchema = z
  .string()
  .min(3)
  .max(20)
  .regex(/^[a-zA-Z0-9_-]+$/);

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  username: usernameSchema,
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const patchPasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type PatchPasswordInput = z.infer<typeof patchPasswordSchema>;
