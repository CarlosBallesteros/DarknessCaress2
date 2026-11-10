// Async wrapper for Express route handlers (docs/09 phase 1). Express 4 does
// not catch rejected promises from async handlers - forward them to
// next(error) so the error path sees them instead of the request hanging.
import type { NextFunction, Request, RequestHandler, Response } from "express";

type AsyncRequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<unknown>;

export function wrapAsync(handler: AsyncRequestHandler): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
