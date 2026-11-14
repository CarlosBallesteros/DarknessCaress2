import type { NextFunction, Request, RequestHandler, Response } from "express";

export function wrapAsync<
  Params = Record<string, string>,
  ResBody = unknown,
  ReqBody = unknown,
  ReqQuery = Record<string, unknown>,
>(
  handler: (
    req: Request<Params, ResBody, ReqBody, ReqQuery>,
    res: Response<ResBody>,
    next: NextFunction,
  ) => Promise<void> | void,
): RequestHandler<Params, ResBody, ReqBody, ReqQuery> {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
