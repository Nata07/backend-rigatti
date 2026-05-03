const express = require("express");
const request = require("supertest");

const { auditLogger } = require("../../src/middleware/auditLogger");

describe("auditLogger", () => {
  function createAuditApp({ method = "post", auth }) {
    const app = express();
    const requestLogger = { info: jest.fn() };
    const logger = {
      child: jest.fn().mockReturnValue(requestLogger),
    };

    app.use((req, _res, next) => {
      req.id = "req-1";
      req.auth = auth;
      next();
    });
    app.use(auditLogger({ logger }));
    app[method]("/resource/:id", (req, res) => {
      res.status(201).json({ id: req.params.id });
    });

    return { app, logger, requestLogger };
  }

  it("captures admin mutations as audit logs", async () => {
    const { app, requestLogger } = createAuditApp({
      auth: {
        userId: "admin-1",
        companyId: "company-1",
        role: "admin",
      },
    });

    const response = await request(app).post("/resource/42");

    expect(response.status).toBe(201);
    expect(requestLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "admin_audit",
        audit: expect.objectContaining({
          action: "POST",
          resource: "/resource/42",
          targetId: "42",
          statusCode: 201,
          outcome: "success",
        }),
        admin: {
          userId: "admin-1",
          companyId: "company-1",
          role: "admin",
        },
      }),
      "Admin action audited",
    );
  });

  it("ignores non-admin requests", async () => {
    const { app, requestLogger } = createAuditApp({
      auth: {
        userId: "user-1",
        companyId: "company-1",
        role: "user",
      },
    });

    await request(app).post("/resource/42");

    expect(requestLogger.info).not.toHaveBeenCalled();
  });

  it("ignores read-only admin requests", async () => {
    const { app, requestLogger } = createAuditApp({
      method: "get",
      auth: {
        userId: "admin-1",
        companyId: "company-1",
        role: "admin",
      },
    });

    await request(app).get("/resource/42");

    expect(requestLogger.info).not.toHaveBeenCalled();
  });
});
