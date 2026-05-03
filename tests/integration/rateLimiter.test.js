const request = require("supertest");
const { MongoMemoryServer } = require("mongodb-memory-server");

const { createApp } = require("../../src/app");
const { connectToDatabase, disconnectFromDatabase } = require("../../src/config/database");
const { createAuthenticate } = require("../../src/middleware/authenticate");
const { createLogger } = require("../../src/middleware/requestLogger");
const { createRateLimiters } = require("../../src/middleware/rateLimiter");
const { Company, Conversation, Product, User } = require("../../src/models");
const { createConversationRepository } = require("../../src/repositories/conversationRepository");
const { createProductRepository } = require("../../src/repositories/productRepository");
const createChatRouter = require("../../src/routes/chat");
const createChatStreamRouter = require("../../src/routes/chatStream");
const { loginUser, registerUser } = require("../../src/services/authService");
const { createChatService } = require("../../src/services/chatService");
const { createProductSearchService } = require("../../src/services/productSearchService");
const { createToolExecutor } = require("../../src/services/toolExecutor");
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

describe("rate limiting integration flow", () => {
  let app;
  let rateLimitLogger;
  let rateLimitRedis;
  let llmClient;
  let mongoServer;
  let signToken;
  let verifyToken;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectToDatabase(mongoServer.getUri());
    await Promise.all([Company.syncIndexes(), Conversation.syncIndexes(), Product.syncIndexes(), User.syncIndexes()]);
  });

  beforeEach(async () => {
    await Promise.all([Company.deleteMany({}), Conversation.deleteMany({}), Product.deleteMany({}), User.deleteMany({})]);

    rateLimitLogger = {
      warn: jest.fn(),
    };
    signToken = createJwtSigner({
      secret: "super-secret-key-for-tests-with-32-chars",
      expiresIn: "1h",
    });
    verifyToken = createJwtVerifier({
      secret: "super-secret-key-for-tests-with-32-chars",
    });
    llmClient = {
      createChatCompletion: jest.fn().mockResolvedValue({
        message: { role: "assistant", content: "Reply" },
      }),
      streamChatCompletion: jest.fn().mockResolvedValue({
        conversation: { _id: "conversation-1" },
      }),
    };

    rateLimitRedis = new FakeRateLimitRedis();

    const rateLimiters = createRateLimiters(
      {
        redis: rateLimitRedis,
        logger: rateLimitLogger,
      },
      {
        loginWindowMs: 60_000,
        loginMax: 5,
        registerWindowMs: 60_000,
        registerMax: 3,
        chatWindowMs: 60_000,
        chatMax: 20,
        streamMax: 10,
        streamLeaseMs: 60_000,
      },
    );

    app = createApp({
      logger: createLogger("silent"),
      corsOrigin: "http://localhost:3000",
      getHealthStatus: () => ({
        status: "ok",
        database: "connected",
        redis: "connected",
      }),
      authConfig: {
        registerUser,
        loginUser,
        hashPassword: createPasswordHasher(4),
        comparePassword: createPasswordVerifier(),
        signToken,
        verifyToken,
        registerRateLimiter: rateLimiters.registerRateLimiter,
        loginRateLimiter: rateLimiters.loginRateLimiter,
      },
      registerRoutes(currentApp) {
        currentApp.use(
          "/api/chat",
          createChatRouter({
            authenticate: createAuthenticate({ verifyToken }),
            chatService: createChatService({
              conversationRepository: createConversationRepository(),
              llmClient,
              toolExecutor: createToolExecutor({
                productSearchService: createProductSearchService({
                  productRepository: createProductRepository(),
                }),
              }),
              systemPrompt: "You are a product assistant.",
            }),
            chatRateLimiter: rateLimiters.chatRateLimiter,
          }),
        );
        currentApp.use(
          "/api/chat/stream",
          createChatStreamRouter({
            authenticate: createAuthenticate({ verifyToken }),
            chatService: {
              streamChatCompletion: llmClient.streamChatCompletion,
            },
            logger: createLogger("silent"),
            streamTimeoutMs: 1_000,
            streamRateLimiter: rateLimiters.streamRateLimiter,
          }),
        );
      },
    });
  });

  afterAll(async () => {
    await disconnectFromDatabase();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  async function registerUserToken(email, companyName = "Acme") {
    const response = await request(app).post("/api/auth/register").send({
      name: email.split("@")[0],
      email,
      password: "password123",
      companyName,
    });

    return response.body.token;
  }

  it("limits login requests to 5 per minute per IP and returns X-RateLimit headers", async () => {
    await registerUserToken("alice@example.com");

    let response;
    for (let index = 0; index < 6; index += 1) {
      response = await request(app).post("/api/auth/login").send({
        email: "alice@example.com",
        password: "password123",
      });
    }

    expect(response.status).toBe(429);
    expect(response.headers["x-ratelimit-limit"]).toBe("5");
    expect(response.headers["x-ratelimit-remaining"]).toBe("0");
    expect(response.body.error.message).toBe("Too many login attempts, please try again later");
  });

  it("limits register requests to 3 per minute per IP", async () => {
    const responses = [];
    for (let index = 0; index < 4; index += 1) {
      responses.push(
        await request(app).post("/api/auth/register").send({
          name: `User ${index}`,
          email: `user${index}@example.com`,
          password: "password123",
          companyName: "Acme",
        }),
      );
    }

    expect(responses[3].status).toBe(429);
    expect(responses[3].body.error.message).toBe("Too many registration attempts, please try again later");
  });

  it("limits chat requests per user and bypasses admins", async () => {
    const adminToken = await registerUserToken("admin@example.com", "AdminCo");
    const userToken = await registerUserToken("member@example.com", "AdminCo");

    let blockedResponse;
    for (let index = 0; index < 21; index += 1) {
      blockedResponse = await request(app)
        .post("/api/chat")
        .set("Authorization", `Bearer ${userToken}`)
        .send({ message: `Message ${index}` });
    }

    expect(blockedResponse.status).toBe(429);
    expect(blockedResponse.body.error.message).toBe("Too many chat requests, please slow down");

    for (let index = 0; index < 25; index += 1) {
      const response = await request(app)
        .post("/api/chat")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ message: `Admin ${index}` });
      expect(response.status).toBe(200);
    }
  });

  it("limits stream requests to 10 concurrent streams per user", async () => {
    await registerUserToken("stream-admin@example.com", "StreamCo");
    const token = await registerUserToken("streamer@example.com", "StreamCo");
    const auth = verifyToken(token);
    rateLimitRedis.entries.set(`rl:stream:user:${auth.userId}`, {
      value: 10,
      expiresAt: Date.now() + 60_000,
    });

    const blockedResponse = await request(app)
      .post("/api/chat/stream")
      .set("Authorization", `Bearer ${token}`)
      .send({ message: "Blocked" });

    expect(blockedResponse.status).toBe(429);
    expect(blockedResponse.headers["x-ratelimit-limit"]).toBe("10");
    expect(blockedResponse.headers["x-ratelimit-remaining"]).toBe("0");
    expect(blockedResponse.body.error.message).toBe(
      "Too many concurrent chat streams, please wait for an active stream to finish",
    );
  });

  it("logs rate limit violations", async () => {
    await registerUserToken("alice2@example.com");

    for (let index = 0; index < 6; index += 1) {
      await request(app).post("/api/auth/login").send({
        email: "alice2@example.com",
        password: "password123",
      });
    }

    expect(rateLimitLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/api/auth/login",
      }),
      "Rate limit exceeded",
    );
  });
});
