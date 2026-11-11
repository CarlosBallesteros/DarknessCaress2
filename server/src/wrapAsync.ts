import type { NextFunction, Request, RequestHandler, Response } from "express";

// Express 4 does not catch rejections from async handlers; every async route in
// this project is wrapped so a rejected promise lands on next() (the error
// middleware) instead of becoming an unhandled rejection that kills the process.
export function wrapAsync(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
