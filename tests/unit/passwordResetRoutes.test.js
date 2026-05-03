const express = require("express");
const request = require("supertest");

const { errorHandler } = require("../../src/middleware/errorHandler");
const passwordResetRouter = require("../../src/routes/passwordReset");

describe("password reset routes", () => {
  function createTestApp(dependencies) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.log = {
        info: jest.fn(),
        warn: jest.fn(),
      };
      next();
    });
    app.use("/api/auth", passwordResetRouter(dependencies));
    app.use(errorHandler());
    return app;
  }

  it("returns 400 for invalid forgot-password payloads", async () => {
    const app = createTestApp({
      forgotPassword: jest.fn(),
    });

    const response = await request(app).post("/api/auth/forgot-password").send({
      email: "not-an-email",
    });

    expect(response.status).toBe(400);
    expect(response.body.error.message).toContain("Invalid email address");
  });

  it("returns 400 for invalid reset-password payloads", async () => {
    const app = createTestApp({
      resetPassword: jest.fn(),
    });

    const response = await request(app).post("/api/auth/reset-password").send({
      token: "",
      password: "short",
    });

    expect(response.status).toBe(400);
    expect(response.body.error.message).toContain("Too small");
  });
});
