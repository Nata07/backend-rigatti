import type { NextFunction, Request, RequestHandler, Response } from "express";

import { User } from "../models";
import type { HttpError } from "../types/http";

interface VerifiedUserDocument {
  verified: boolean;
}

interface RequireVerifiedLogger {
  warn(payload: Record<string, unknown>, message: string): void;
}

export interface RequireVerifiedDependencies {
  findUserById?(userId: string): Promise<VerifiedUserDocument | null>;
}

function createHttpError(statusCode: number, message: string): HttpError {
  const error = new Error(message) as HttpError;
  error.statusCode = statusCode;
  return error;
}

export function createRequireVerified({
  findUserById = async (userId: string) =>
    (await User.findById(userId).select({ verified: 1 }).lean()) as VerifiedUserDocument | null,
}: RequireVerifiedDependencies = {}): RequestHandler {
  return function requireVerified(req: Request, _res: Response, next: NextFunction): void {
    void (async () => {
      if (!req.auth?.userId) {
        throw createHttpError(401, "Authentication token is required");
      }

      const user = await findUserById(req.auth.userId);

      if (!user) {
        throw createHttpError(401, "Authenticated user not found");
      }

      if (!user.verified) {
        const logger = req.log as RequireVerifiedLogger | undefined;
        logger?.warn(
          {
            event: "auth_unverified_access_blocked",
            requestId: req.id,
            userId: req.auth.userId,
            companyId: req.auth.companyId,
            path: req.originalUrl,
            method: req.method,
          },
          "Blocked unverified user access",
        );
        throw createHttpError(403, "Email verification required");
      }

      next();
    })().catch(next);
  };
}
