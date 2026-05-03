const request = require("supertest");
const { MongoMemoryServer } = require("mongodb-memory-server");

const { createApp } = require("../../src/app");
const { connectToDatabase, disconnectFromDatabase } = require("../../src/config/database");
const { createAuthenticate } = require("../../src/middleware/authenticate");
const { createLogger } = require("../../src/middleware/requestLogger");
const { Company, Conversation, Product, User } = require("../../src/models");
const { createConversationRepository } = require("../../src/repositories/conversationRepository");
const { createProductRepository } = require("../../src/repositories/productRepository");
const createChatStreamRouter = require("../../src/routes/chatStream");
const { loginUser, registerUser } = require("../../src/services/authService");
const { createChatService } = require("../../src/services/chatService");
const { createProductSearchService } = require("../../src/services/productSearchService");
const { createToolExecutor } = require("../../src/services/toolExecutor");
const { createJwtSigner, createJwtVerifier } = require("../../src/utils/jwt");
const { createPasswordHasher, createPasswordVerifier } = require("../../src/utils/password");

describe("chat stream integration flow", () => {
  let app;
  let llmClient;
  let mongoServer;
  let verifyToken;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectToDatabase(mongoServer.getUri());
    await Promise.all([Company.syncIndexes(), Conversation.syncIndexes(), Product.syncIndexes(), User.syncIndexes()]);
  });

  beforeEach(async () => {
    await Promise.all([Company.deleteMany({}), Conversation.deleteMany({}), Product.deleteMany({}), User.deleteMany({})]);

    llmClient = {
      createChatCompletion: jest.fn(),
      streamChatCompletion: jest.fn(),
    };

    const signToken = createJwtSigner({
      secret: "super-secret-key-for-tests-with-32-chars",
      expiresIn: "1h",
    });
    verifyToken = createJwtVerifier({
      secret: "super-secret-key-for-tests-with-32-chars",
    });

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
        hashPassword: createPasswordHasher(4),
        comparePassword: createPasswordVerifier(),
        signToken,
        verifyToken,
      },
      registerRoutes(currentApp) {
        currentApp.use(
          "/api/chat/stream",
          createChatStreamRouter({
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
            logger: createLogger("silent"),
            streamTimeoutMs: 1000,
          })
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

  async function registerUserForCompany({ name, email, companyName }) {
    const response = await request(app).post("/api/auth/register").send({
      name,
      email,
      password: "password123",
      companyName,
    });

    return response.body.token;
  }

  it("returns 401 on POST /api/chat/stream without authentication", async () => {
    const response = await request(app).post("/api/chat/stream").send({ message: "Hello" });

    expect(response.status).toBe(401);
  });

  it("streams start, token, tool, and complete events and persists the conversation", async () => {
    const token = await registerUserForCompany({
      name: "Alice",
      email: "alice@example.com",
      companyName: "Company A",
    });
    const auth = verifyToken(token);

    await Product.create({
      companyId: auth.companyId,
      name: "Keyboard A",
      description: "Mechanical keyboard for Company A",
      price: 120,
      category: "Accessories",
    });

    llmClient.streamChatCompletion.mockImplementationOnce(async (_input, handlers) => {
      await handlers.onToken("Found ");
      await handlers.onToken("products.");
      await handlers.onToolCall({
        id: "call-1",
        name: "search_products",
        argumentsJson: "{\"query\":\"Keyboard\",\"limit\":5}",
      });

      return {
        message: { role: "assistant", content: null },
        toolCalls: [{ id: "call-1", name: "search_products", argumentsJson: "{\"query\":\"Keyboard\",\"limit\":5}" }],
      };
    });
    llmClient.streamChatCompletion.mockImplementationOnce(async (_input, handlers) => {
      await handlers.onToken("I found one matching product.");

      return {
        message: { role: "assistant", content: "I found one matching product." },
      };
    });

    const response = await request(app)
      .post("/api/chat/stream")
      .set("Authorization", `Bearer ${token}`)
      .send({ message: "Find keyboards" });

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");

    const events = parseSseEvents(response.text);
    expect(events.map((event) => event.type)).toEqual([
      "start",
      "token",
      "token",
      "tool_call",
      "tool_result",
      "token",
      "complete",
    ]);
    expect(events[0].data).toEqual({});
    expect(events[1].data).toBe("Found ");
    expect(events[2].data).toBe("products.");
    expect(events[3].data).toMatchObject({
      id: "call-1",
      name: "search_products",
    });
    expect(events[4].data).toMatchObject({
      toolCallId: "call-1",
      name: "search_products",
    });
    expect(events[5].data).toBe("I found one matching product.");
    expect(events[6].data).toMatchObject({
      conversationId: expect.any(String),
    });

    const conversation = await Conversation.findOne({ userId: auth.userId, companyId: auth.companyId }).lean();
    expect(conversation.messages).toHaveLength(2);
    expect(conversation.messages[0]).toMatchObject({ role: "user", content: "Find keyboards" });
    expect(conversation.messages[1]).toMatchObject({ role: "assistant", content: "I found one matching product." });
    expect(conversation.messages[1].content).not.toContain("Company B");
  });

  it("emits an error event when streaming fails", async () => {
    const token = await registerUserForCompany({
      name: "Alice",
      email: "alice2@example.com",
      companyName: "Company A",
    });

    llmClient.streamChatCompletion.mockRejectedValue(
      Object.assign(new Error("LLM provider request failed"), { statusCode: 502, provider: "openai" })
    );

    const response = await request(app)
      .post("/api/chat/stream")
      .set("Authorization", `Bearer ${token}`)
      .send({ message: "Find keyboards" });

    expect(response.status).toBe(200);
    expect(parseSseEvents(response.text)).toEqual([
      { type: "start", data: {} },
      { type: "error", data: { message: "LLM provider request failed" } },
    ]);
  });

  it("times out inactive streams", async () => {
    const token = await registerUserForCompany({
      name: "Alice",
      email: "alice3@example.com",
      companyName: "Company A",
    });

    const timeoutApp = createApp({
      logger: createLogger("silent"),
      corsOrigin: "http://localhost:3000",
      getHealthStatus: () => ({
        status: "ok",
        database: "connected",
      }),
      authConfig: {
        registerUser,
        loginUser,
        hashPassword: createPasswordHasher(4),
        comparePassword: createPasswordVerifier(),
        signToken: createJwtSigner({
          secret: "super-secret-key-for-tests-with-32-chars",
          expiresIn: "1h",
        }),
        verifyToken,
      },
      registerRoutes(currentApp) {
        currentApp.use(
          "/api/chat/stream",
          createChatStreamRouter({
            authenticate: createAuthenticate({ verifyToken }),
            chatService: {
              streamChatCompletion: () => new Promise(() => {}),
            },
            logger: createLogger("silent"),
            streamTimeoutMs: 25,
          })
        );
      },
    });

    const response = await request(timeoutApp)
      .post("/api/chat/stream")
      .set("Authorization", `Bearer ${token}`)
      .send({ message: "Find keyboards" });

    expect(response.status).toBe(200);

    const events = parseSseEvents(response.text);
    expect(events[0]).toEqual({ type: "start", data: {} });
    expect(events[1]).toEqual({ type: "error", data: { message: "Streaming timed out" } });
  });
});

function parseSseEvents(payload) {
  return payload
    .trim()
    .split("\n\n")
    .filter(Boolean)
    .map((chunk) => {
      const lines = chunk.split("\n");
      const type = lines.find((line) => line.startsWith("event: ")).slice("event: ".length);
      const data = JSON.parse(lines.find((line) => line.startsWith("data: ")).slice("data: ".length));

      return { type, data };
    });
}
