import type {
  ErrorRequestHandler,
  NextFunction,
  Request,
  RequestHandler,
  Response,
} from "express";
import type { Logger } from "pino";

import type { HttpError } from "../types/http";

interface ErrorResponseBody {
  error: {
    message: string;
    statusCode: number;
    requestId?: string | undefined;
  };
}

export interface ErrorHandlerDependencies {
  logger?: Logger;
}

export const notFoundHandler: RequestHandler = (
  req: Request,
  _res: Response,
  next: NextFunction,
): void => {
  const error = new Error(`Route not found: ${req.method} ${req.originalUrl}`) as HttpError;
  error.statusCode = 404;
  next(error);
};

export function errorHandler({
  logger,
}: ErrorHandlerDependencies = {}): ErrorRequestHandler {
  return (
    error: HttpError,
    req: Request,
    res: Response<ErrorResponseBody>,
    next: NextFunction,
  ): void => {
    const statusCode = Number.isInteger(error.statusCode) ? (error.statusCode as number) : 500;
    const isOperational = statusCode < 500;
    const durationMs = req.requestStartedAt
      ? Number(process.hrtime.bigint() - req.requestStartedAt) / 1_000_000
      : undefined;
    const requestLogger = req.log ?? logger?.child({ requestId: req.id });

    if (requestLogger) {
      requestLogger[isOperational ? "warn" : "error"](
        {
          event: "request_failed",
          err: error,
          req,
          res: {
            statusCode,
            getHeader: res.getHeader.bind(res),
          },
          statusCode,
          durationMs,
          userId: req.auth?.userId,
          companyId: req.auth?.companyId,
        },
        "Request failed",
      );
    }

    if (res.headersSent) {
      next(error);
      return;
    }

    res.status(statusCode).json({
      error: {
        message: error.message || "Internal Server Error",
        statusCode,
        requestId: req.id,
      },
    });
  };
}
