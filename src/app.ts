import cors from "cors";
import express, { type Express } from "express";
import type { Logger } from "pino";

import { auditLogger } from "./middleware/auditLogger";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { requestLogger } from "./middleware/requestLogger";
import authRouter, { type AuthRouterDependencies } from "./routes/auth";
import healthRouter from "./routes/health";

interface HealthStatus {
  status: "ok" | "degraded";
  database: string;
  redis: string;
  redisFallbackEnabled?: boolean;
}

export interface AppDependencies {
  logger: Logger;
  getHealthStatus: () => HealthStatus;
  corsOrigin: string;
  authConfig?: AuthRouterDependencies;
  registerRoutes?: (app: Express) => void;
}

export function createApp({
  logger,
  getHealthStatus,
  corsOrigin,
  authConfig,
  registerRoutes,
}: AppDependencies) {
  const app = express();

  app.disable("x-powered-by");
  app.use(
    cors({
      origin: corsOrigin,
    }),
  );
  app.use(express.json());
  app.use(requestLogger({ logger }));
  app.use(auditLogger({ logger }));
  app.use("/health", healthRouter({ getHealthStatus }));
  if (authConfig) {
    app.use("/api/auth", authRouter(authConfig));
  }
  if (typeof registerRoutes === "function") {
    registerRoutes(app);
  }
  app.use(notFoundHandler);
  app.use(errorHandler({ logger }));

  return app;
}
