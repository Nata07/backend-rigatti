const request = require("supertest");
const { MongoMemoryServer } = require("mongodb-memory-server");

const { createApp } = require("../../src/app");
const { connectToDatabase, disconnectFromDatabase } = require("../../src/config/database");
const { createAuthenticate } = require("../../src/middleware/authenticate");
const { createRequireVerified } = require("../../src/middleware/requireVerified");
const { createRateLimiters } = require("../../src/middleware/rateLimiter");
const { createLogger } = require("../../src/middleware/requestLogger");
const { Company, User } = require("../../src/models");
const createChatRouter = require("../../src/routes/chat");
const {
  loginUser,
  registerUser,
  resendVerificationEmail,
  verifyEmail,
} = require("../../src/services/authService");
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

describe("email verification integration flow", () => {
  let app;
  let mongoServer;
  let emailService;
  let signToken;
  let verifyToken;
  let signVerificationToken;
  let logger;
  let rateLimitLogger;
  let authConfig;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectToDatabase(mongoServer.getUri());
    await Promise.all([Company.syncIndexes(), User.syncIndexes()]);
  });

  beforeEach(async () => {
    await Promise.all([Company.deleteMany({}), User.deleteMany({})]);

    emailService = {
      sendVerificationEmail: jest.fn().mockResolvedValue({ id: "verification-1" }),
    };
    signToken = createJwtSigner({
      secret: "super-secret-key-for-tests-with-32-chars",
      expiresIn: "1h",
    });
    verifyToken = createJwtVerifier({
      secret: "super-secret-key-for-tests-with-32-chars",
    });
    signVerificationToken = createJwtSigner({
      secret: "super-secret-key-for-tests-with-32-chars",
      expiresIn: "24h",
    });
    logger = createLogger("silent");
    jest.spyOn(logger, "info");
    jest.spyOn(logger, "warn");
    rateLimitLogger = {
      warn: jest.fn(),
    };

    const rateLimiters = createRateLimiters(
      {
        redis: new FakeRateLimitRedis(),
        logger: rateLimitLogger,
      },
      {
        resendVerificationWindowMs: 60_000,
        resendVerificationMax: 1,
      },
    );

    authConfig = {
      registerUser,
      loginUser,
      resendVerificationEmail,
      verifyEmail,
      hashPassword: createPasswordHasher(4),
      comparePassword: createPasswordVerifier(),
      signToken,
      verifyToken,
      signVerificationToken,
      verifyVerificationToken: createJwtVerifier({
        secret: "super-secret-key-for-tests-with-32-chars",
      }),
      emailService,
      resendVerificationRateLimiter: rateLimiters.resendVerificationRateLimiter,
    };

    const authenticate = createAuthenticate({ verifyToken });
    const requireVerified = createRequireVerified();
    const chatService = {
      getActiveConversation: jest.fn().mockResolvedValue({ id: "conversation-1", messages: [] }),
      processMessage: jest.fn().mockResolvedValue({ reply: "ok" }),
    };

    app = createApp({
      logger,
      corsOrigin: "http://localhost:3000",
      getHealthStatus: () => ({
        status: "ok",
        database: "connected",
        redis: "connected",
      }),
      authConfig,
      registerRoutes(currentApp) {
        currentApp.use(
          "/api/chat",
          createChatRouter({
            authenticate,
            requireVerified,
            chatService,
          }),
        );
      },
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
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

  it("registers users as unverified and sends a verification email", async () => {
    const response = await registerDefaultUser();

    expect(response.status).toBe(201);
    expect(emailService.sendVerificationEmail).toHaveBeenCalledWith("alice@example.com", expect.any(String));

    const user = await User.findOne({ email: "alice@example.com" }).lean();
    expect(user.verified).toBe(false);

    const token = emailService.sendVerificationEmail.mock.calls[0][1];
    const payload = authConfig.verifyVerificationToken(token);
    expect(payload.type).toBe("email-verification");
    expect(payload.exp - payload.iat).toBe(86400);
  });

  it("verifies the user from the token query string", async () => {
    await registerDefaultUser();
    const token = emailService.sendVerificationEmail.mock.calls[0][1];

    const response = await request(app).get("/api/auth/verify-email").query({ token });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: "Email verified" });

    const user = await User.findOne({ email: "alice@example.com" }).lean();
    expect(user.verified).toBe(true);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "auth_verification_completed",
      }),
      "Email verification completed",
    );
  });

  it("resends a verification email for unverified users", async () => {
    await registerDefaultUser();
    emailService.sendVerificationEmail.mockClear();

    const response = await request(app).post("/api/auth/resend-verification").send({
      email: "alice@example.com",
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: "Verification email sent" });
    expect(emailService.sendVerificationEmail).toHaveBeenCalledTimes(1);
  });

  it("returns 400 for an expired verification token", async () => {
    await registerDefaultUser();
    const expiredApp = createApp({
      logger,
      corsOrigin: "http://localhost:3000",
      getHealthStatus: () => ({
        status: "ok",
        database: "connected",
        redis: "connected",
      }),
      authConfig: {
        ...authConfig,
        verifyVerificationToken: () => {
          const error = new Error("jwt expired");
          error.name = "TokenExpiredError";
          throw error;
        },
      },
    });

    const response = await request(expiredApp).get("/api/auth/verify-email").query({
      token: "expired-token",
    });

    expect(response.status).toBe(400);
    expect(response.body.error.message).toBe("Verification token expired");
  });

  it("blocks unverified users from restricted routes", async () => {
    const registerResponse = await registerDefaultUser();

    const response = await request(app)
      .post("/api/chat")
      .set("Authorization", `Bearer ${registerResponse.body.token}`)
      .send({ message: "hello" });

    expect(response.status).toBe(403);
    expect(response.body.error.message).toBe("Email verification required");
  });

  it("rate limits resend verification requests", async () => {
    await registerDefaultUser();
    emailService.sendVerificationEmail.mockClear();

    const first = await request(app).post("/api/auth/resend-verification").send({
      email: "alice@example.com",
    });
    const second = await request(app).post("/api/auth/resend-verification").send({
      email: "alice@example.com",
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect(second.body.error.message).toBe("Too many verification email requests, please try again later");
    expect(rateLimitLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/api/auth/resend-verification",
      }),
      "Rate limit exceeded",
    );
  });
});
