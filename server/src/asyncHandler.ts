import type { NextFunction, Request, RequestHandler, Response } from "express";

/** Express 4 doesn't forward a rejected promise from an async handler to error
 * middleware on its own — it just becomes an unhandled rejection. This makes
 * that automatic. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
