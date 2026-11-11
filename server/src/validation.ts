import type { ZodType } from "zod";
import { HttpError } from "./httpError";

// Contract (docs/06 conventions): zod failures are `400 {"error":"<first zod issue>"}`.
export function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new HttpError(400, result.error.issues[0]?.message ?? "Invalid request body");
  }
  return result.data;
}
