import type { NextFunction, Request, Response } from "express";

export function wrapAsync(
  handler: (req: Request, res: Response, next: NextFunction) => unknown,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
