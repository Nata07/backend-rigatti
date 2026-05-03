const express = require("express");
const request = require("supertest");

const { errorHandler } = require("../../src/middleware/errorHandler");
const { requireAdmin } = require("../../src/middleware/requireAdmin");

describe("requireAdmin middleware", () => {
  function createTestApp(role) {
    const app = express();

    app.get(
      "/admin",
      (req, res, next) => {
        req.auth = { role };
        next();
      },
      requireAdmin,
      (req, res) => {
        res.json({ ok: true });
      }
    );
    app.use(errorHandler());

    return app;
  }

  it("allows admin users", async () => {
    const response = await request(createTestApp("admin")).get("/admin");

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
  });

  it("blocks non-admin users with 403", async () => {
    const response = await request(createTestApp("user")).get("/admin");

    expect(response.status).toBe(403);
    expect(response.body.error.message).toBe("Admin role required");
  });
});
