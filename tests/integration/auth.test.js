const express = require("express");

const { MongoMemoryServer } = require("mongodb-memory-server");
const request = require("supertest");

const { createApp } = require("../../src/app");
const { connectToDatabase, disconnectFromDatabase } = require("../../src/config/database");
const { createJwtSigner, createJwtVerifier } = require("../../src/utils/jwt");
const { createAuthenticate } = require("../../src/middleware/authenticate");
const { requireAdmin } = require("../../src/middleware/requireAdmin");
const { createPasswordHasher, createPasswordVerifier } = require("../../src/utils/password");
const { createLogger } = require("../../src/middleware/requestLogger");
const { Company, User } = require("../../src/models");
const { loginUser, registerUser } = require("../../src/services/authService");

describe("auth integration flow", () => {
  let mongoServer;
  let app;
  let signToken;
  let verifyToken;
  let hashPassword;
  let comparePassword;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectToDatabase(mongoServer.getUri());
    await Promise.all([Company.syncIndexes(), User.syncIndexes()]);
  });

  beforeEach(async () => {
    await Promise.all([Company.deleteMany({}), User.deleteMany({})]);

    signToken = createJwtSigner({
      secret: "super-secret-key-for-tests-with-32-chars",
      expiresIn: "1h",
    });
    verifyToken = createJwtVerifier({
      secret: "super-secret-key-for-tests-with-32-chars",
    });
    hashPassword = createPasswordHasher(4);
    comparePassword = createPasswordVerifier();

    app = createApp({
      logger: createLogger("silent"),
      corsOrigin: "http://localhost:3000",
      getHealthStatus: () => ({
        status: "ok",
        database: "connected",
      }),
      authConfig: {
        registerUser,
        loginUser,
        hashPassword,
        comparePassword,
        signToken,
        verifyToken,
      },
      registerRoutes(currentApp) {
        currentApp.get("/protected", createAuthenticate({ verifyToken }), (req, res) => {
          res.json({ auth: req.auth });
        });
        currentApp.get("/admin-only", createAuthenticate({ verifyToken }), requireAdmin, (req, res) => {
          res.json({ ok: true });
        });
      },
    });
  });

  afterAll(async () => {
    await disconnectFromDatabase();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  it("registers the first user as admin for a new company", async () => {
    const response = await request(app).post("/api/auth/register").send({
      name: "Alice",
      email: "alice@example.com",
      password: "password123",
      companyName: "Acme",
    });

    expect(response.status).toBe(201);
    expect(response.body.user.role).toBe("admin");
    expect(response.body.user.email).toBe("alice@example.com");
    expect(response.body.user.passwordHash).toBeUndefined();

    const savedUser = await User.findOne({ email: "alice@example.com" }).lean();
    expect(savedUser.passwordHash).not.toBe("password123");
  });

  it("registers a subsequent user as regular user for an existing company", async () => {
    await request(app).post("/api/auth/register").send({
      name: "Alice",
      email: "alice@example.com",
      password: "password123",
      companyName: "Acme",
    });

    const response = await request(app).post("/api/auth/register").send({
      name: "Bob",
      email: "bob@example.com",
      password: "password123",
      companyName: "Acme",
    });

    expect(response.status).toBe(201);
    expect(response.body.user.role).toBe("user");
  });

  it("returns a valid JWT on login that can be decoded", async () => {
    await request(app).post("/api/auth/register").send({
      name: "Alice",
      email: "alice@example.com",
      password: "password123",
      companyName: "Acme",
    });

    const response = await request(app).post("/api/auth/login").send({
      email: "alice@example.com",
      password: "password123",
    });

    expect(response.status).toBe(200);

    const payload = verifyToken(response.body.token);
    expect(payload).toMatchObject({
      userId: expect.any(String),
      companyId: expect.any(String),
      role: "admin",
    });
  });

  it("allows access to a protected route with a valid JWT", async () => {
    const registerResponse = await request(app).post("/api/auth/register").send({
      name: "Alice",
      email: "alice@example.com",
      password: "password123",
      companyName: "Acme",
    });

    const response = await request(app)
      .get("/protected")
      .set("Authorization", `Bearer ${registerResponse.body.token}`);

    expect(response.status).toBe(200);
    expect(response.body.auth.role).toBe("admin");
  });

  it("rejects protected routes without JWT", async () => {
    const response = await request(app).get("/protected");

    expect(response.status).toBe(401);
    expect(response.body.error.message).toBe("Authentication token is required");
  });

  it("rejects admin-only routes for user role", async () => {
    await request(app).post("/api/auth/register").send({
      name: "Alice",
      email: "alice@example.com",
      password: "password123",
      companyName: "Acme",
    });
    const userResponse = await request(app).post("/api/auth/register").send({
      name: "Bob",
      email: "bob@example.com",
      password: "password123",
      companyName: "Acme",
    });

    const response = await request(app)
      .get("/admin-only")
      .set("Authorization", `Bearer ${userResponse.body.token}`);

    expect(response.status).toBe(403);
    expect(response.body.error.message).toBe("Admin role required");
  });
});
