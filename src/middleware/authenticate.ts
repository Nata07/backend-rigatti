import type { NextFunction, Request, RequestHandler, Response } from "express";

import type { AuthContext, JwtClaims } from "../types/auth";
import type { HttpError } from "../types/http";

export interface AuthenticateDependencies {
  verifyToken(token: string): JwtClaims;
}

function createHttpError(statusCode: number, message: string): HttpError {
  const error = new Error(message) as HttpError;
  error.statusCode = statusCode;
  return error;
}

function toAuthContext(payload: JwtClaims): AuthContext {
  return {
    userId: payload.userId,
    companyId: payload.companyId,
    role: payload.role,
  };
}

export function createAuthenticate({
  verifyToken,
}: AuthenticateDependencies): RequestHandler {
  return function authenticate(req: Request, _res: Response, next: NextFunction): void {
    const authorization = req.headers.authorization;

    if (!authorization || !authorization.startsWith("Bearer ")) {
      next(createHttpError(401, "Authentication token is required"));
      return;
    }

    const token = authorization.slice("Bearer ".length).trim();

    try {
      req.auth = toAuthContext(verifyToken(token));
      next();
    } catch {
      next(createHttpError(401, "Invalid authentication token"));
    }
  };
}
