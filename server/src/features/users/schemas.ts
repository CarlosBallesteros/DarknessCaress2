import { z } from "zod";

const usernameSchema = z
  .string()
  .min(3)
  .max(20)
  .regex(/^[a-zA-Z0-9_-]+$/);

export const patchMeSchema = z
  .object({
    username: usernameSchema.optional(),
    theme: z.string().min(1).optional(),
  })
  .refine((data) => data.username !== undefined || data.theme !== undefined, {
    message: "At least one field is required",
  });

export type PatchMeInput = z.infer<typeof patchMeSchema>;
