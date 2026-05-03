const { MongoMemoryServer } = require("mongodb-memory-server");
const request = require("supertest");

const { createApp } = require("../../src/app");
const { loadEnv } = require("../../src/config/env");
const { connectToDatabase, disconnectFromDatabase, getDatabaseStatus } = require("../../src/config/database");
const { createLogger } = require("../../src/middleware/requestLogger");

describe("application bootstrap and health endpoint", () => {
  const originalEnv = process.env;
  let mongoServer;
  let app;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      PORT: "4011",
      MONGODB_URI: mongoServer.getUri(),
      REDIS_URL: "redis://redis.example.test:6379",
      CORS_ORIGIN: "http://localhost:3000",
      LOG_LEVEL: "silent",
      JWT_SECRET: "super-secret-key-for-tests-with-32-chars",
      JWT_EXPIRES_IN: "1h",
      BCRYPT_SALT_ROUNDS: "10",
      OPENAI_API_KEY: "test-openai-key",
    };

    const env = loadEnv();
    await connectToDatabase(env.MONGODB_URI);

    app = createApp({
      logger: createLogger(env.LOG_LEVEL),
      corsOrigin: env.CORS_ORIGIN,
      getHealthStatus: () => ({
        status: getDatabaseStatus() === "connected" ? "ok" : "degraded",
        database: getDatabaseStatus(),
        redis: "connected",
      }),
    });
  });

  afterAll(async () => {
    await disconnectFromDatabase();
    if (mongoServer) {
      await mongoServer.stop();
    }
    process.env = originalEnv;
  });

  it("starts with valid env configuration", () => {
    expect(() => loadEnv()).not.toThrow();
  });

  it("fails to start with invalid env configuration", () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      PORT: "0",
      MONGODB_URI: "",
      REDIS_URL: "",
      CORS_ORIGIN: "",
      LOG_LEVEL: "silent",
      JWT_SECRET: "short",
      JWT_EXPIRES_IN: "",
      BCRYPT_SALT_ROUNDS: "2",
      OPENAI_API_KEY: "",
    };

    expect(() => loadEnv()).toThrow(/Invalid environment configuration/);

    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      PORT: "4011",
      MONGODB_URI: mongoServer.getUri(),
      REDIS_URL: "redis://redis.example.test:6379",
      CORS_ORIGIN: "http://localhost:3000",
      LOG_LEVEL: "silent",
      JWT_SECRET: "super-secret-key-for-tests-with-32-chars",
      JWT_EXPIRES_IN: "1h",
      BCRYPT_SALT_ROUNDS: "10",
      OPENAI_API_KEY: "test-openai-key",
    };
  });

  it("returns 200 on GET /health when MongoDB is connected", async () => {
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ok");
    expect(response.body.database).toBe("connected");
    expect(response.body.requestId).toBeTruthy();
    expect(response.headers["x-request-id"]).toBeTruthy();
    expect(response.body.redis).toBe("connected");
  });

  it("returns 404 through the centralized error pipeline for unknown routes", async () => {
    const response = await request(app).get("/missing-route");

    expect(response.status).toBe(404);
    expect(response.body.error.message).toContain("Route not found");
    expect(response.body.error.requestId).toBeTruthy();
  });

  it("returns 503 on GET /health when the database is disconnected", async () => {
    await disconnectFromDatabase();

    const degradedApp = createApp({
      logger: createLogger("silent"),
      corsOrigin: "http://localhost:3000",
      getHealthStatus: () => ({
        status: getDatabaseStatus() === "connected" ? "ok" : "degraded",
        database: getDatabaseStatus(),
        redis: "disconnected",
      }),
    });

    const response = await request(degradedApp).get("/health");

    expect(response.status).toBe(503);
    expect(response.body.database).toBe("disconnected");
    expect(response.body.redis).toBe("disconnected");

    await connectToDatabase(mongoServer.getUri());
  });

  it("echoes an incoming request id for traceability", async () => {
    const response = await request(app).get("/health").set("x-request-id", "external-request-id");

    expect(response.headers["x-request-id"]).toBe("external-request-id");
    expect(response.body.requestId).toBe("external-request-id");
  });
});
