import pino, { type DestinationStream, type Logger, type LoggerOptions } from "pino";
import type { Request, Response } from "express";

const DEFAULT_SERVICE_NAME = "mini-saas-backend";

export const SENSITIVE_LOG_PATHS = [
  "authorization",
  "headers.authorization",
  "req.headers.authorization",
  "password",
  "passwordHash",
  "body.password",
  "req.body.password",
  "token",
  "body.token",
  "req.body.token",
  "accessToken",
  "body.accessToken",
  "req.body.accessToken",
  "refreshToken",
  "body.refreshToken",
  "req.body.refreshToken",
] as const;

type RequestLike = Pick<Request, "id" | "method" | "originalUrl" | "headers" | "ip">;
type ResponseLike = Pick<Response, "statusCode" | "getHeader">;

export function serializeRequest(req: RequestLike) {
  return {
    id: req.id,
    method: req.method,
    url: req.originalUrl,
    headers: req.headers,
    remoteAddress: req.ip,
  };
}

export function serializeResponse(res: ResponseLike) {
  const contentLength = res.getHeader("content-length");

  return {
    statusCode: res.statusCode,
    contentLength:
      typeof contentLength === "string" || typeof contentLength === "number"
        ? Number(contentLength)
        : undefined,
  };
}

export function buildLoggerOptions(level = "info"): LoggerOptions {
  return {
    level,
    messageKey: "message",
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
      bindings: (bindings) => ({
        pid: bindings.pid,
        hostname: bindings.hostname,
        service: DEFAULT_SERVICE_NAME,
      }),
    },
    redact: {
      paths: [...SENSITIVE_LOG_PATHS],
      remove: true,
    },
    serializers: {
      req: serializeRequest,
      res: serializeResponse,
      err: pino.stdSerializers.err,
    },
  };
}

export function createLogger(level = "info", destination?: DestinationStream): Logger {
  return pino(buildLoggerOptions(level), destination);
}
