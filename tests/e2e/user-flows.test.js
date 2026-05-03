const request = require("supertest");
const { MongoMemoryServer } = require("mongodb-memory-server");

const { createApp } = require("../../src/app");
const { connectToDatabase, disconnectFromDatabase } = require("../../src/config/database");
const { createAuthenticate } = require("../../src/middleware/authenticate");
const { createLogger } = require("../../src/middleware/requestLogger");
const { createRequireVerified } = require("../../src/middleware/requireVerified");
const { Company, Conversation, Product, User } = require("../../src/models");
const { createConversationRepository } = require("../../src/repositories/conversationRepository");
const { createProductRepository } = require("../../src/repositories/productRepository");
const createChatRouter = require("../../src/routes/chat");
const createProductsRouter = require("../../src/routes/products");
const {
  forgotPassword,
  loginUser,
  registerUser,
  resendVerificationEmail,
  resetPassword,
  verifyEmail,
} = require("../../src/services/authService");
const { createChatService } = require("../../src/services/chatService");
const { createProductSearchService } = require("../../src/services/productSearchService");
const { createProductService } = require("../../src/services/productService");
const { createToolExecutor } = require("../../src/services/toolExecutor");
const { createJwtSigner, createJwtVerifier } = require("../../src/utils/jwt");
const { createPasswordHasher, createPasswordVerifier } = require("../../src/utils/password");
const { buildProductPayload, buildRegistrationPayload } = require("../fixtures/factories");
const { createMockEmailService, createMockLlmClient } = require("../fixtures/mocks");

describe("critical user flows", () => {
  let app;
  let emailService;
  let llmClient;
  let mongoServer;
  let verifyResetToken;
  let verifyToken;
  let verifyVerificationToken;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectToDatabase(mongoServer.getUri());
    await Promise.all([
      Company.syncIndexes(),
      Conversation.syncIndexes(),
      Product.syncIndexes(),
      User.syncIndexes(),
    ]);
  });

  beforeEach(async () => {
    await Promise.all([
      Company.deleteMany({}),
      Conversation.deleteMany({}),
      Product.deleteMany({}),
      User.deleteMany({}),
    ]);

    emailService = createMockEmailService();
    llmClient = createMockLlmClient();

    const signToken = createJwtSigner({
      secret: "super-secret-key-for-tests-with-32-chars",
      expiresIn: "1h",
    });
    verifyToken = createJwtVerifier({
      secret: "super-secret-key-for-tests-with-32-chars",
    });
    const signResetToken = createJwtSigner({
      secret: "super-secret-key-for-tests-with-32-chars",
      expiresIn: "15m",
    });
    verifyResetToken = createJwtVerifier({
      secret: "super-secret-key-for-tests-with-32-chars",
    });
    const signVerificationToken = createJwtSigner({
      secret: "super-secret-key-for-tests-with-32-chars",
      expiresIn: "24h",
    });
    verifyVerificationToken = createJwtVerifier({
      secret: "super-secret-key-for-tests-with-32-chars",
    });

    app = createApp({
      logger: createLogger("silent"),
      corsOrigin: "http://localhost:3000",
      getHealthStatus: () => ({
        status: "ok",
        database: "connected",
        redis: "connected",
      }),
      authConfig: {
        comparePassword: createPasswordVerifier(),
        emailService,
        forgotPassword,
        hashPassword: createPasswordHasher(4),
        loginUser,
        registerUser,
        resendVerificationEmail,
        resetPassword,
        signResetToken,
        signToken,
        signVerificationToken,
        verifyEmail,
        verifyResetToken,
        verifyToken,
        verifyVerificationToken,
      },
      registerRoutes(currentApp) {
        const authenticate = createAuthenticate({ verifyToken });
        const requireVerified = createRequireVerified();

        currentApp.use(
          "/api/products",
          createProductsRouter({
            authenticate,
            productService: createProductService({
              productRepository: createProductRepository(),
            }),
            requireAdmin: (req, _res, next) => {
              if (req.auth?.role !== "admin") {
                const error = new Error("Admin role required");
                error.statusCode = 403;
                next(error);
                return;
              }

              next();
            },
            requireVerified,
          }),
        );

        currentApp.use(
          "/api/chat",
          createChatRouter({
            authenticate,
            chatService: createChatService({
              conversationRepository: createConversationRepository(),
              llmClient,
              systemPrompt: "You are a product assistant.",
              toolExecutor: createToolExecutor({
                productSearchService: createProductSearchService({
                  productRepository: createProductRepository(),
                }),
              }),
            }),
            requireVerified,
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

  it("completes registration, email verification, and AI chat access", async () => {
    llmClient.createChatCompletion.mockResolvedValue({
      message: { role: "assistant", content: "Verified users can chat." },
    });

    const registerResponse = await request(app)
      .post("/api/auth/register")
      .send(buildRegistrationPayload());

    expect(registerResponse.status).toBe(201);
    expect(registerResponse.body.user.verified).toBe(false);
    expect(emailService.sendVerificationEmail).toHaveBeenCalledWith(
      "alice@example.com",
      expect.any(String),
    );

    const blockedChatResponse = await request(app)
      .post("/api/chat")
      .set("Authorization", `Bearer ${registerResponse.body.token}`)
      .send({ message: "Can I use AI already?" });

    expect(blockedChatResponse.status).toBe(403);
    expect(blockedChatResponse.body.error.message).toBe("Email verification required");

    const verificationToken = emailService.sendVerificationEmail.mock.calls[0][1];
    expect(verifyVerificationToken(verificationToken).type).toBe("email-verification");

    const verifyResponse = await request(app)
      .get("/api/auth/verify-email")
      .query({ token: verificationToken });

    expect(verifyResponse.status).toBe(200);
    expect(verifyResponse.body).toEqual({ message: "Email verified" });

    const chatResponse = await request(app)
      .post("/api/chat")
      .set("Authorization", `Bearer ${registerResponse.body.token}`)
      .send({ message: "Can I use AI already?" });

    expect(chatResponse.status).toBe(200);
    expect(chatResponse.body.assistantMessage.content).toBe("Verified users can chat.");
  });

  it("supports login and product CRUD after verification", async () => {
    const registerResponse = await request(app)
      .post("/api/auth/register")
      .send(buildRegistrationPayload());
    const verificationToken = emailService.sendVerificationEmail.mock.calls[0][1];

    await request(app).get("/api/auth/verify-email").query({ token: verificationToken });

    const loginResponse = await request(app).post("/api/auth/login").send({
      email: "alice@example.com",
      password: "Password123",
    });

    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body.user.verified).toBe(true);

    const createResponse = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send(buildProductPayload());

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.name).toBe("Keyboard");

    const listResponse = await request(app)
      .get("/api/products")
      .set("Authorization", `Bearer ${loginResponse.body.token}`);

    expect(listResponse.status).toBe(200);
    expect(listResponse.body).toHaveLength(1);

    const updateResponse = await request(app)
      .put(`/api/products/${createResponse.body._id}`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send(buildProductPayload({ name: "Keyboard Pro", price: 150 }));

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.name).toBe("Keyboard Pro");

    const deleteResponse = await request(app)
      .delete(`/api/products/${createResponse.body._id}`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`);

    expect(deleteResponse.status).toBe(204);
  });

  it("supports password reset end to end and invalidates the old password", async () => {
    await request(app).post("/api/auth/register").send(buildRegistrationPayload());

    const forgotResponse = await request(app).post("/api/auth/forgot-password").send({
      email: "alice@example.com",
    });

    expect(forgotResponse.status).toBe(200);
    expect(emailService.sendPasswordReset).toHaveBeenCalledWith(
      "alice@example.com",
      expect.any(String),
    );

    const resetToken = emailService.sendPasswordReset.mock.calls[0][1];
    expect(verifyResetToken(resetToken).type).toBe("password-reset");

    const resetResponse = await request(app).post("/api/auth/reset-password").send({
      token: resetToken,
      password: "NewPassword123",
    });

    expect(resetResponse.status).toBe(200);
    expect(resetResponse.body).toEqual({ message: "Password reset successful" });

    const oldLoginResponse = await request(app).post("/api/auth/login").send({
      email: "alice@example.com",
      password: "Password123",
    });
    const newLoginResponse = await request(app).post("/api/auth/login").send({
      email: "alice@example.com",
      password: "NewPassword123",
    });

    expect(oldLoginResponse.status).toBe(401);
    expect(newLoginResponse.status).toBe(200);
  });
});
