import type { NextFunction, Request, RequestHandler, Response } from "express";

import type { HttpError } from "../types/http";

function createHttpError(statusCode: number, message: string): HttpError {
  const error = new Error(message) as HttpError;
  error.statusCode = statusCode;
  return error;
}

export const requireAdmin: RequestHandler = (
  req: Request,
  _res: Response,
  next: NextFunction,
): void => {
  if (req.auth?.role !== "admin") {
    next(createHttpError(403, "Admin role required"));
    return;
  }

  next();
};
