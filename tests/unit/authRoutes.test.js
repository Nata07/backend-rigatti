const express = require("express");
const request = require("supertest");

const { errorHandler } = require("../../src/middleware/errorHandler");
const authRouter = require("../../src/routes/auth");

describe("auth routes", () => {
  function createTestApp(dependencies) {
    const app = express();
    app.use(express.json());
    app.use("/api/auth", authRouter(dependencies));
    app.use(errorHandler());
    return app;
  }

  it("returns 400 for invalid register payloads", async () => {
    const app = createTestApp({
      registerUser: jest.fn(),
    });

    const response = await request(app).post("/api/auth/register").send({
      name: "",
      email: "not-an-email",
      password: "short",
      companyName: "",
    });

    expect(response.status).toBe(400);
    expect(response.body.error.message).toContain("Too small");
  });

  it("returns 400 for invalid login payloads", async () => {
    const app = createTestApp({
      loginUser: jest.fn(),
    });

    const response = await request(app).post("/api/auth/login").send({
      email: "not-an-email",
      password: "",
    });

    expect(response.status).toBe(400);
    expect(response.body.error.message).toContain("Invalid email address");
  });

  it("returns 400 for invalid resend-verification payloads", async () => {
    const app = createTestApp({
      resendVerificationEmail: jest.fn(),
    });

    const response = await request(app).post("/api/auth/resend-verification").send({
      email: "not-an-email",
    });

    expect(response.status).toBe(400);
    expect(response.body.error.message).toContain("Invalid email address");
  });

  it("returns 400 for invalid verify-email payloads", async () => {
    const app = createTestApp({
      verifyEmail: jest.fn(),
    });

    const response = await request(app).get("/api/auth/verify-email");

    expect(response.status).toBe(400);
    expect(response.body.error.message).toContain("expected string");
  });
});
