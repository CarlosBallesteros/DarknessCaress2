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
  .refine((value) => value.username !== undefined || value.theme !== undefined, {
    message: "At least one field must be provided",
  });

export type PatchMeInput = z.infer<typeof patchMeSchema>;
