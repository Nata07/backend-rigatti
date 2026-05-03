import express, { type Request, type Response } from "express";

interface HealthStatus {
  status: "ok" | "degraded";
  database: string;
  redis: string;
  redisFallbackEnabled?: boolean;
}

interface HealthResponseBody extends HealthStatus {
  requestId?: string | undefined;
  timestamp: string;
}

export interface HealthRouterDependencies {
  getHealthStatus(): HealthStatus;
}

export default function healthRouter({ getHealthStatus }: HealthRouterDependencies) {
  const router = express.Router();

  router.get("/", (req: Request, res: Response<HealthResponseBody>) => {
    const health = getHealthStatus();
    const statusCode = health.status === "ok" ? 200 : 503;

    res.status(statusCode).json({
      ...health,
      requestId: req.id,
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}
