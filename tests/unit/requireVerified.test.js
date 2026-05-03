const express = require("express");
const request = require("supertest");

const { errorHandler } = require("../../src/middleware/errorHandler");
const { createRequireVerified } = require("../../src/middleware/requireVerified");

describe("requireVerified middleware", () => {
  function createTestApp(findUserById, auth = { userId: "user-1", companyId: "company-1", role: "user" }) {
    const app = express();
    app.use((req, _res, next) => {
      req.auth = auth;
      req.log = {
        warn: jest.fn(),
      };
      next();
    });
    app.get("/protected", createRequireVerified({ findUserById }), (_req, res) => {
      res.json({ ok: true });
    });
    app.use(errorHandler());
    return app;
  }

  it("allows verified users", async () => {
    const app = createTestApp(jest.fn().mockResolvedValue({ verified: true }));

    const response = await request(app).get("/protected");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  it("blocks unverified users", async () => {
    const app = createTestApp(jest.fn().mockResolvedValue({ verified: false }));

    const response = await request(app).get("/protected");

    expect(response.status).toBe(403);
    expect(response.body.error.message).toBe("Email verification required");
  });

  it("returns 401 when the authenticated user no longer exists", async () => {
    const app = createTestApp(jest.fn().mockResolvedValue(null));

    const response = await request(app).get("/protected");

    expect(response.status).toBe(401);
    expect(response.body.error.message).toBe("Authenticated user not found");
  });
});
