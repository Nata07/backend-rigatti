const express = require("express");
const request = require("supertest");

const { createAuthenticate } = require("../../src/middleware/authenticate");
const { errorHandler } = require("../../src/middleware/errorHandler");

describe("authenticate middleware", () => {
  function createTestApp(verifyToken) {
    const app = express();

    app.get("/protected", createAuthenticate({ verifyToken }), (req, res) => {
      res.json({ auth: req.auth });
    });
    app.use(errorHandler());

    return app;
  }

  it("decodes a valid JWT and attaches req.auth", async () => {
    const app = createTestApp(() => ({
      userId: "user-1",
      companyId: "company-1",
      role: "admin",
    }));

    const response = await request(app).get("/protected").set("Authorization", "Bearer valid-token");

    expect(response.status).toBe(200);
    expect(response.body.auth).toEqual({
      userId: "user-1",
      companyId: "company-1",
      role: "admin",
    });
  });

  it("returns 401 when the token is missing", async () => {
    const app = createTestApp(() => ({}));

    const response = await request(app).get("/protected");

    expect(response.status).toBe(401);
    expect(response.body.error.message).toBe("Authentication token is required");
  });

  it("returns 401 when the token is invalid", async () => {
    const app = createTestApp(() => {
      throw new Error("bad token");
    });

    const response = await request(app).get("/protected").set("Authorization", "Bearer invalid-token");

    expect(response.status).toBe(401);
    expect(response.body.error.message).toBe("Invalid authentication token");
  });
});
