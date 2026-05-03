jest.mock("../../src/config/env", () => ({
  loadEnv: jest.fn(),
}));

jest.mock("../../src/config/database", () => ({
  connectToDatabase: jest.fn(),
  disconnectFromDatabase: jest.fn(),
  getDatabaseStatus: jest.fn(),
}));

jest.mock("../../src/config/redis", () => ({
  createRedisClient: jest.fn(),
}));

jest.mock("../../src/middleware/requestLogger", () => ({
  createLogger: jest.fn(),
}));

jest.mock("../../src/app", () => ({
  createApp: jest.fn(),
}));

jest.mock("http", () => ({
  ...jest.requireActual("http"),
  createServer: jest.fn(),
}));

const http = require("http");

const { createApp } = require("../../src/app");
const database = require("../../src/config/database");
const { loadEnv } = require("../../src/config/env");
const { createRedisClient } = require("../../src/config/redis");
const { startServer } = require("../../src/index");
const { createLogger } = require("../../src/middleware/requestLogger");

describe("startServer", () => {
  async function flushAsyncWork() {
    await new Promise((resolve) => setImmediate(resolve));
  }

  let logger;
  let redis;
  let server;
  let exitSpy;
  let onceSpy;
  let signalHandlers;

  beforeEach(() => {
    jest.clearAllMocks();
    signalHandlers = {};

    logger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    };

    redis = {
      connect: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
      getStatus: jest.fn().mockReturnValue({
        status: "connected",
        fallbackEnabled: false,
        poolSize: 2,
      }),
    };

    server = {
      listen: jest.fn((port, callback) => callback()),
      close: jest.fn((callback) => callback()),
    };

    loadEnv.mockReturnValue({
      PORT: 4020,
      MONGODB_URI: "mongodb://localhost:27017/test",
      REDIS_URL: "redis://localhost:6379",
      CORS_ORIGIN: "http://localhost:3000",
      LOG_LEVEL: "silent",
      JWT_SECRET: "super-secret-key-for-tests-with-32-chars",
      JWT_EXPIRES_IN: "1h",
      BCRYPT_SALT_ROUNDS: 10,
      OPENAI_API_KEY: "test-openai-key",
      FRONTEND_URL: "http://localhost:3000",
      SMTP_HOST: "smtp.example.test",
      SMTP_PORT: 587,
      SMTP_SECURE: false,
      SMTP_USER: "smtp-user",
      SMTP_PASS: "smtp-pass",
      SMTP_FROM: "no-reply@example.test",
      EMAIL_RETRY_MAX_ATTEMPTS: 4,
      EMAIL_RETRY_DELAY_MS: 500,
      RATE_LIMIT_LOGIN_WINDOW_MS: 60000,
      RATE_LIMIT_LOGIN_MAX: 5,
      RATE_LIMIT_REGISTER_WINDOW_MS: 60000,
      RATE_LIMIT_REGISTER_MAX: 3,
      RATE_LIMIT_FORGOT_PASSWORD_WINDOW_MS: 60000,
      RATE_LIMIT_FORGOT_PASSWORD_MAX: 3,
      RATE_LIMIT_RESEND_VERIFICATION_WINDOW_MS: 60000,
      RATE_LIMIT_RESEND_VERIFICATION_MAX: 3,
      RATE_LIMIT_CHAT_WINDOW_MS: 60000,
      RATE_LIMIT_CHAT_MAX: 20,
      RATE_LIMIT_STREAM_MAX_CONCURRENT: 10,
      RATE_LIMIT_STREAM_LEASE_MS: 60000,
    });
    createLogger.mockReturnValue(logger);
    createRedisClient.mockReturnValue(redis);
    database.getDatabaseStatus.mockReturnValue("connected");
    createApp.mockReturnValue({ app: true });
    http.createServer.mockReturnValue(server);

    onceSpy = jest.spyOn(process, "once").mockImplementation((signal, handler) => {
      signalHandlers[signal] = handler;
      return process;
    });
    exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined);
  });

  afterEach(() => {
    onceSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("starts the server with validated env and database connection", async () => {
    const result = await startServer();

    expect(loadEnv).toHaveBeenCalled();
    expect(createLogger).toHaveBeenCalledWith("silent");
    expect(createRedisClient).toHaveBeenCalledWith({
      url: "redis://localhost:6379",
      logger,
    });
    expect(database.connectToDatabase).toHaveBeenCalledWith("mongodb://localhost:27017/test");
    expect(redis.connect).toHaveBeenCalled();
    expect(createApp).toHaveBeenCalledWith({
      logger,
      corsOrigin: "http://localhost:3000",
      authConfig: {
        comparePassword: expect.any(Function),
        emailService: expect.any(Object),
        forgotPassword: expect.any(Function),
        forgotPasswordRateLimiter: expect.any(Function),
        hashPassword: expect.any(Function),
        loginUser: expect.any(Function),
        loginRateLimiter: expect.any(Function),
        registerUser: expect.any(Function),
        registerRateLimiter: expect.any(Function),
        resendVerificationEmail: expect.any(Function),
        resendVerificationRateLimiter: expect.any(Function),
        resetPassword: expect.any(Function),
        signResetToken: expect.any(Function),
        signToken: expect.any(Function),
        signVerificationToken: expect.any(Function),
        verifyEmail: expect.any(Function),
        verifyResetToken: expect.any(Function),
        verifyToken: expect.any(Function),
        verifyVerificationToken: expect.any(Function),
      },
      getHealthStatus: expect.any(Function),
      registerRoutes: expect.any(Function),
    });
    expect(server.listen).toHaveBeenCalledWith(4020, expect.any(Function));
    expect(result.server).toBe(server);
    expect(onceSpy).toHaveBeenCalledWith("SIGINT", expect.any(Function));
    expect(onceSpy).toHaveBeenCalledWith("SIGTERM", expect.any(Function));
  });

  it("reports healthy database status through the injected health callback", async () => {
    await startServer();

    const createAppCall = createApp.mock.calls[0][0];
    expect(createAppCall.getHealthStatus()).toEqual({
      status: "ok",
      database: "connected",
      redis: "connected",
      redisFallbackEnabled: false,
    });

    database.getDatabaseStatus.mockReturnValue("disconnected");
    expect(createAppCall.getHealthStatus()).toEqual({
      status: "degraded",
      database: "disconnected",
      redis: "connected",
      redisFallbackEnabled: false,
    });
  });

  it("shuts down gracefully", async () => {
    const result = await startServer();

    await result.shutdown("SIGTERM");

    expect(server.close).toHaveBeenCalled();
    expect(database.disconnectFromDatabase).toHaveBeenCalled();
    expect(redis.disconnect).toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith({ signal: "SIGTERM" }, "Shutting down server");
  });

  it("exits with code 0 after a successful signal-based shutdown", async () => {
    await startServer();

    signalHandlers.SIGINT();
    await flushAsyncWork();

    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("logs and exits with code 1 when graceful shutdown fails", async () => {
    server.close.mockImplementationOnce((callback) => callback(new Error("close failed")));

    await startServer();
    signalHandlers.SIGTERM();
    await flushAsyncWork();

    expect(logger.error).toHaveBeenCalledWith(
      {
        err: expect.any(Error),
        signal: "SIGTERM",
      },
      "Graceful shutdown failed"
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
