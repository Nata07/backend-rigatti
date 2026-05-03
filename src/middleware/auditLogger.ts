import type { Logger } from "pino";
import type { Request, RequestHandler, Response } from "express";

const DEFAULT_AUDIT_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export interface AuditLoggerDependencies {
  logger: Logger;
}

export function auditLogger({ logger }: AuditLoggerDependencies): RequestHandler {
  return (req: Request, res: Response, next): void => {
    if (!DEFAULT_AUDIT_METHODS.has(req.method.toUpperCase())) {
      next();
      return;
    }

    res.on("finish", () => {
      if (req.auth?.role !== "admin") {
        return;
      }

      const targetId = typeof req.params.id === "string" ? req.params.id : undefined;
      const requestLogger = req.log ?? logger.child({ requestId: req.id });

      requestLogger.info(
        {
          event: "admin_audit",
          audit: {
            action: req.method.toUpperCase(),
            resource: req.originalUrl,
            targetId,
            statusCode: res.statusCode,
            outcome: res.statusCode < 400 ? "success" : "failure",
          },
          admin: {
            userId: req.auth.userId,
            companyId: req.auth.companyId,
            role: req.auth.role,
          },
        },
        "Admin action audited",
      );
    });

    next();
  };
}

