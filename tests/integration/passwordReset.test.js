const request = require("supertest");
const { MongoMemoryServer } = require("mongodb-memory-server");

const { createApp } = require("../../src/app");
const { connectToDatabase, disconnectFromDatabase } = require("../../src/config/database");
const { createLogger } = require("../../src/middleware/requestLogger");
const { createRateLimiters } = require("../../src/middleware/rateLimiter");
const { Company, User } = require("../../src/models");
const { forgotPassword, loginUser, registerUser, resetPassword } = require("../../src/services/authService");
const { createJwtSigner, createJwtVerifier } = require("../../src/utils/jwt");
const { createPasswordHasher, createPasswordVerifier } = require("../../src/utils/password");

class FakeRateLimitRedis {
  constructor() {
    this.entries = new Map();
  }

  async command(command, ...args) {
    const normalizedCommand = command.toUpperCase();
    const key = args[0];

    if (normalizedCommand === "GET") {
      const entry = this.getEntry(key);
      return entry ? String(entry.value) : null;
    }

    if (normalizedCommand === "INCR") {
      const entry = this.ensureEntry(key);
      entry.value += 1;
      return entry.value;
    }

    if (normalizedCommand === "DECR") {
      const entry = this.ensureEntry(key);
      entry.value -= 1;

      if (entry.value <= 0) {
        this.entries.delete(key);
        return 0;
      }

      return entry.value;
    }

    if (normalizedCommand === "DEL") {
      return this.entries.delete(key) ? 1 : 0;
    }

    if (normalizedCommand === "PEXPIRE") {
      const entry = this.ensureEntry(key);
      entry.expiresAt = Date.now() + Number(args[1]);
      return 1;
    }

    if (normalizedCommand === "PTTL") {
      const entry = this.getEntry(key);
      return entry ? Math.max(entry.expiresAt - Date.now(), 0) : -2;
    }

    throw new Error(`Unsupported Redis command: ${command}`);
  }

  async runWithFallback(_operationName, operation) {
    return operation();
  }

  getEntry(key) {
    const entry = this.entries.get(key);
    if (!entry) {
      return null;
    }

    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return null;
    }

    return entry;
  }

  ensureEntry(key) {
    const existing = this.getEntry(key);
    if (existing) {
      return existing;
    }

    const entry = {
      value: 0,
      expiresAt: Date.now() + 60_000,
    };
    this.entries.set(key, entry);
    return entry;
  }
}

describe("password reset integration flow", () => {
  let app;
  let mongoServer;
  let emailService;
  let signToken;
  let verifyToken;
  let signResetToken;
  let verifyResetToken;
  let rateLimitLogger;
  let authConfig;
  let rateLimiters;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectToDatabase(mongoServer.getUri());
    await Promise.all([Company.syncIndexes(), User.syncIndexes()]);
  });

  beforeEach(async () => {
    await Promise.all([Company.deleteMany({}), User.deleteMany({})]);

    emailService = {
      sendPasswordReset: jest.fn().mockResolvedValue({ id: "reset-1" }),
    };
    signToken = createJwtSigner({
      secret: "super-secret-key-for-tests-with-32-chars",
      expiresIn: "1h",
    });
    verifyToken = createJwtVerifier({
      secret: "super-secret-key-for-tests-with-32-chars",
    });
    signResetToken = createJwtSigner({
      secret: "super-secret-key-for-tests-with-32-chars",
      expiresIn: "15m",
    });
    verifyResetToken = createJwtVerifier({
      secret: "super-secret-key-for-tests-with-32-chars",
    });
    rateLimitLogger = {
      warn: jest.fn(),
    };

    rateLimiters = createRateLimiters(
      {
        redis: new FakeRateLimitRedis(),
        logger: rateLimitLogger,
      },
      {
        forgotPasswordWindowMs: 60_000,
        forgotPasswordMax: 1,
      }
    );

    authConfig = {
      registerUser,
      loginUser,
      forgotPassword,
      resetPassword,
      hashPassword: createPasswordHasher(4),
      comparePassword: createPasswordVerifier(),
      signToken,
      verifyToken,
      signResetToken,
      verifyResetToken,
      emailService,
      forgotPasswordRateLimiter: rateLimiters.forgotPasswordRateLimiter,
    };

    app = createApp({
      logger: createLogger("silent"),
      corsOrigin: "http://localhost:3000",
      getHealthStatus: () => ({
        status: "ok",
        database: "connected",
        redis: "connected",
      }),
      authConfig,
    });
  });

  afterAll(async () => {
    await disconnectFromDatabase();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  async function registerDefaultUser() {
    return request(app).post("/api/auth/register").send({
      name: "Alice",
      email: "alice@example.com",
      password: "password123",
      companyName: "Acme",
    });
  }

  it("returns 200 and emails a valid reset token without exposing account existence", async () => {
    await registerDefaultUser();

    const response = await request(app).post("/api/auth/forgot-password").send({
      email: "Alice@Example.com",
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      message: "If account exists, reset email sent",
    });
    expect(emailService.sendPasswordReset).toHaveBeenCalledWith("alice@example.com", expect.any(String));

    const token = emailService.sendPasswordReset.mock.calls[0][1];
    const payload = verifyResetToken(token);
    expect(payload.type).toBe("password-reset");
    expect(payload.exp - payload.iat).toBe(900);
  });

  it("returns the same response when the user does not exist", async () => {
    const response = await request(app).post("/api/auth/forgot-password").send({
      email: "missing@example.com",
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      message: "If account exists, reset email sent",
    });
    expect(emailService.sendPasswordReset).not.toHaveBeenCalled();
  });

  it("updates the password and allows login with the new password", async () => {
    await registerDefaultUser();
    await request(app).post("/api/auth/forgot-password").send({
      email: "alice@example.com",
    });

    const token = emailService.sendPasswordReset.mock.calls[0][1];
    const resetResponse = await request(app).post("/api/auth/reset-password").send({
      token,
      password: "new-password123",
    });

    expect(resetResponse.status).toBe(200);
    expect(resetResponse.body).toEqual({
      message: "Password reset successful",
    });

    const oldLogin = await request(app).post("/api/auth/login").send({
      email: "alice@example.com",
      password: "password123",
    });
    const newLogin = await request(app).post("/api/auth/login").send({
      email: "alice@example.com",
      password: "new-password123",
    });

    expect(oldLogin.status).toBe(401);
    expect(newLogin.status).toBe(200);
  });

  it("returns 400 for an invalid reset token", async () => {
    await registerDefaultUser();

    const invalidToken = signToken({
      userId: "user-1",
      companyId: "company-1",
      role: "admin",
    });

    const response = await request(app).post("/api/auth/reset-password").send({
      token: invalidToken,
      password: "new-password123",
    });

    expect(response.status).toBe(400);
    expect(response.body.error.message).toBe("Invalid token");
  });

  it("returns 400 for an expired reset token", async () => {
    await registerDefaultUser();
    const expiredApp = createApp({
      logger: createLogger("silent"),
      corsOrigin: "http://localhost:3000",
      getHealthStatus: () => ({
        status: "ok",
        database: "connected",
        redis: "connected",
      }),
      authConfig: {
        ...authConfig,
        verifyResetToken: () => {
          const error = new Error("jwt expired");
          error.name = "TokenExpiredError";
          throw error;
        },
      },
    });

    const response = await request(expiredApp).post("/api/auth/reset-password").send({
      token: "expired-token",
      password: "new-password123",
    });

    expect(response.status).toBe(400);
    expect(response.body.error.message).toBe("Reset token expired");
  });

  it("rate limits forgot-password requests", async () => {
    await registerDefaultUser();

    const first = await request(app).post("/api/auth/forgot-password").send({
      email: "alice@example.com",
    });
    const second = await request(app).post("/api/auth/forgot-password").send({
      email: "alice@example.com",
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect(second.body.error.message).toBe("Too many password reset attempts, please try again later");
    expect(rateLimitLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/api/auth/forgot-password",
      }),
      "Rate limit exceeded"
    );
  });
});
