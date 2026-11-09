import type { Response } from "express";
import type { z, ZodType } from "zod";

/**
 * Parses a request body against a zod schema; on failure answers
 * `400 {"error": "<first zod issue>"}` (06 conventions) and returns undefined
 * so the route can simply stop.
 */
export function parseBody<S extends ZodType>(
  schema: S,
  body: unknown,
  res: Response,
): z.output<S> | undefined {
  const result = schema.safeParse(body);
  if (!result.success) {
    res.status(400).json({
      error: result.error.issues[0]?.message ?? "Invalid request body",
    });
    return undefined;
  }
  return result.data;
}
