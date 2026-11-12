import { ZodError } from "zod";

export class HttpError extends Error {
  status: number;
  body: { error: string };

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.body = { error: message };
  }
}

export function firstZodIssue(error: ZodError): string {
  const issue = error.issues[0];
  return issue?.message ?? "Invalid request";
}

export function parseOrThrow<T>(schema: { parse: (data: unknown) => T }, data: unknown): T {
  try {
    return schema.parse(data);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new HttpError(400, firstZodIssue(error));
    }
    throw error;
  }
}
