import type { Response } from "express";
import type { ZodSchema } from "zod";

export function parseBody<T>(schema: ZodSchema<T>, body: unknown, res: Response): T | null {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    res.status(400).json({ error: first?.message ?? "Invalid request" });
    return null;
  }
  return parsed.data;
}
