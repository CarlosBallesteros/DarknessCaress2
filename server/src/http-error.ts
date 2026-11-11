// Shared HTTP plumbing for every feature route: a status-carrying error and
// zod body parsing that turns the FIRST issue into the contract's 400 body
// (docs/06 conventions).
import type { ZodType } from "zod";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    throw new HttpError(
      400,
      result.error.issues[0]?.message ?? "Invalid request body",
    );
  }
  return result.data;
}
