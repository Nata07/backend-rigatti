const { PassThrough } = require("stream");

const request = require("supertest");

const { createApp } = require("../../src/app");
const { createLogger } = require("../../src/config/logger");

describe("structured logging integration", () => {
  let app;
  let logs;

  beforeEach(() => {
    logs = [];

    const destination = new PassThrough();
    destination.on("data", (chunk) => {
      const lines = chunk
        .toString("utf8")
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      logs.push(...lines);
    });

    const logger = createLogger("info", destination);

    app = createApp({
      logger,
      corsOrigin: "http://localhost:3000",
      getHealthStatus: () => ({
        status: "ok",
        database: "connected",
        redis: "connected",
      }),
      registerRoutes(currentApp) {
        currentApp.use((req, _res, next) => {
          if (req.path.startsWith("/admin")) {
            req.auth = {
              userId: "admin-1",
              companyId: "company-1",
              role: "admin",
            };
          }

          next();
        });

        currentApp.post("/admin/products/:id", (req, res) => {
          res.status(201).json({ id: req.params.id, requestId: req.id });
        });

        currentApp.get("/boom", (_req, _res, next) => {
          next(new Error("kaboom"));
        });
      },
    });
  });

  async function waitForLogs() {
    await new Promise((resolve) => setImmediate(resolve));
  }

  it("logs request completion and admin audit entries with request ids", async () => {
    const response = await request(app)
      .post("/admin/products/123")
      .set("x-request-id", "external-request-id")
      .set("authorization", "Bearer secret-token")
      .send({
        password: "secret",
        token: "abc123",
      });

    await waitForLogs();

    expect(response.status).toBe(201);

    const requestLog = logs.find((entry) => entry.event === "http_request_completed");
    const auditLog = logs.find((entry) => entry.event === "admin_audit");

    expect(requestLog).toEqual(
      expect.objectContaining({
        requestId: "external-request-id",
        event: "http_request_completed",
        durationMs: expect.any(Number),
        performance: {
          durationMs: expect.any(Number),
        },
        req: expect.objectContaining({
          id: "external-request-id",
          method: "POST",
          url: "/admin/products/123",
        }),
      }),
    );
    expect(requestLog.req.headers.authorization).toBeUndefined();
    expect(auditLog).toEqual(
      expect.objectContaining({
        requestId: "external-request-id",
        event: "admin_audit",
        audit: expect.objectContaining({
          action: "POST",
          resource: "/admin/products/123",
          targetId: "123",
          outcome: "success",
        }),
      }),
    );
  });

  it("logs full error context with stack traces", async () => {
    const response = await request(app).get("/boom").set("x-request-id", "error-request-id");

    await waitForLogs();

    expect(response.status).toBe(500);

    const errorLog = logs.find((entry) => entry.event === "request_failed");

    expect(errorLog).toEqual(
      expect.objectContaining({
        requestId: "error-request-id",
        event: "request_failed",
        statusCode: 500,
        req: expect.objectContaining({
          id: "error-request-id",
          method: "GET",
          url: "/boom",
        }),
        err: expect.objectContaining({
          message: "kaboom",
          stack: expect.stringContaining("kaboom"),
        }),
      }),
    );
  });
});
