import { randomUUID } from "crypto";

import type { Logger } from "pino";
import type { Request, RequestHandler, Response } from "express";

import { createLogger as createStructuredLogger } from "../config/logger";

export interface LoggerDependencies {
  logger: Logger;
}

export function createLogger(level = "info"): Logger {
  return createStructuredLogger(level);
}

export function requestLogger({ logger }: LoggerDependencies): RequestHandler {
  return (req: Request, res: Response, next): void => {
    req.id = req.headers["x-request-id"]?.toString() ?? randomUUID();
    req.requestStartedAt = process.hrtime.bigint();
    req.log = logger.child({
      requestId: req.id,
      correlationId: req.headers["x-correlation-id"]?.toString() ?? req.id,
    });
    res.setHeader("x-request-id", req.id);

    res.on("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - req.requestStartedAt!) / 1_000_000;

      req.log!.info(
        {
          event: "http_request_completed",
          req,
          res,
          durationMs,
          performance: {
            durationMs,
          },
          userId: req.auth?.userId,
          companyId: req.auth?.companyId,
        },
        "Request completed",
      );
    });

    next();
  };
}
