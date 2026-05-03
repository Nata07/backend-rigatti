const request = require("supertest");
const { MongoMemoryServer } = require("mongodb-memory-server");

const { createApp } = require("../../src/app");
const { connectToDatabase, disconnectFromDatabase } = require("../../src/config/database");
const { createAuthenticate } = require("../../src/middleware/authenticate");
const { createLogger } = require("../../src/middleware/requestLogger");
const { Company, Conversation, Product, User } = require("../../src/models");
const { createConversationRepository } = require("../../src/repositories/conversationRepository");
const createChatRouter = require("../../src/routes/chat");
const { loginUser, registerUser } = require("../../src/services/authService");
const { createChatService } = require("../../src/services/chatService");
const { createProductRepository } = require("../../src/repositories/productRepository");
const { createProductSearchService } = require("../../src/services/productSearchService");
const { createToolExecutor } = require("../../src/services/toolExecutor");
const { createJwtSigner, createJwtVerifier } = require("../../src/utils/jwt");
const { createPasswordHasher, createPasswordVerifier } = require("../../src/utils/password");

describe("chat integration flow", () => {
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

  it("returns the authenticated user's active conversation on GET /api/chat", async () => {
    const token = await registerUserForCompany({
      name: "Alice",
      email: "alice@example.com",
      companyName: "Company A",
    });
    const auth = verifyToken(token);
    await Conversation.create({
      userId: auth.userId,
      companyId: auth.companyId,
      messages: [{ role: "assistant", content: "Previous answer" }],
    });

    const response = await request(app).get("/api/chat").set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.userId).toBe(auth.userId);
    expect(response.body.companyId).toBe(auth.companyId);
    expect(response.body.messages).toHaveLength(1);
    expect(response.body.messages[0].content).toBe("Previous answer");
  });

  it("returns 401 on GET /api/chat without authentication", async () => {
    const response = await request(app).get("/api/chat");

    expect(response.status).toBe(401);
  });

  it("processes a chat message and returns the assistant response", async () => {
    const token = await registerUserForCompany({
      name: "Alice",
      email: "alice@example.com",
      companyName: "Company A",
    });
    llmClient.createChatCompletion.mockResolvedValue({
      message: { role: "assistant", content: "Here is what I found." },
    });

    const response = await request(app)
      .post("/api/chat")
      .set("Authorization", `Bearer ${token}`)
      .send({ message: "Show me products" });

    expect(response.status).toBe(200);
    expect(response.body.assistantMessage).toMatchObject({
      role: "assistant",
      content: "Here is what I found.",
    });
    expect(response.body.conversation.messages).toHaveLength(2);
  });

  it("persists the user and assistant messages on POST /api/chat", async () => {
    const token = await registerUserForCompany({
      name: "Alice",
      email: "alice@example.com",
      companyName: "Company A",
    });
    const auth = verifyToken(token);
    llmClient.createChatCompletion.mockResolvedValue({
      message: { role: "assistant", content: "Here is what I found." },
    });

    const response = await request(app)
      .post("/api/chat")
      .set("Authorization", `Bearer ${token}`)
      .send({ message: "Show me products" });

    expect(response.status).toBe(200);

    const conversation = await Conversation.findOne({ userId: auth.userId, companyId: auth.companyId }).lean();
    expect(conversation.messages).toHaveLength(2);
    expect(conversation.messages[0]).toMatchObject({ role: "user", content: "Show me products" });
    expect(conversation.messages[1]).toMatchObject({ role: "assistant", content: "Here is what I found." });
  });

  it("executes product search with the authenticated tenant companyId only", async () => {
    const tokenA = await registerUserForCompany({
      name: "Alice",
      email: "alice@example.com",
      companyName: "Company A",
    });
    const tokenB = await registerUserForCompany({
      name: "Bob",
      email: "bob@example.com",
      companyName: "Company B",
    });
    const authA = verifyToken(tokenA);
    const authB = verifyToken(tokenB);

    await Product.create([
      {
        companyId: authA.companyId,
        name: "Keyboard A",
        description: "Mechanical keyboard for Company A",
        price: 120,
        category: "Accessories",
      },
      {
        companyId: authB.companyId,
        name: "Keyboard B",
        description: "Mechanical keyboard for Company B",
        price: 140,
        category: "Accessories",
      },
    ]);

    llmClient.createChatCompletion
      .mockResolvedValueOnce({
        message: { role: "assistant", content: null },
        toolCalls: [{ id: "call-1", name: "search_products", argumentsJson: "{\"query\":\"Keyboard\",\"limit\":5}" }],
      })
      .mockResolvedValueOnce({
        message: { role: "assistant", content: "I found one matching product." },
      });

    const response = await request(app)
      .post("/api/chat")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ message: "Find keyboards" });

    expect(response.status).toBe(200);
    expect(llmClient.createChatCompletion).toHaveBeenCalledTimes(2);

    const toolMessage = llmClient.createChatCompletion.mock.calls[1][0].messages.find((message) => message.role === "tool");
    const toolResults = JSON.parse(toolMessage.content);

    expect(toolResults).toHaveLength(1);
    expect(toolResults[0].name).toBe("Keyboard A");
    expect(toolResults[0].name).not.toBe("Keyboard B");
  });

  it("returns 502 on POST /api/chat when the provider fails", async () => {
    const token = await registerUserForCompany({
      name: "Alice",
      email: "alice@example.com",
      companyName: "Company A",
    });
    llmClient.createChatCompletion.mockRejectedValue(
      Object.assign(new Error("LLM provider request failed"), { statusCode: 502, provider: "openai" })
    );

    const response = await request(app)
      .post("/api/chat")
      .set("Authorization", `Bearer ${token}`)
      .send({ message: "Find keyboards" });

    expect(response.status).toBe(502);
    expect(response.body.error.message).toBe("LLM provider request failed");
  });

  it("does not expose user A conversation to user B", async () => {
    const tokenA = await registerUserForCompany({
      name: "Alice",
      email: "alice@example.com",
      companyName: "Company A",
    });
    const tokenB = await registerUserForCompany({
      name: "Bob",
      email: "bob@example.com",
      companyName: "Company B",
    });
    const authA = verifyToken(tokenA);
    const authB = verifyToken(tokenB);

    await Conversation.create({
      userId: authA.userId,
      companyId: authA.companyId,
      messages: [{ role: "assistant", content: "Private tenant A content" }],
    });

    const response = await request(app).get("/api/chat").set("Authorization", `Bearer ${tokenB}`);

    expect(response.status).toBe(200);
    expect(response.body.userId).toBe(authB.userId);
    expect(response.body.companyId).toBe(authB.companyId);
    expect(response.body.messages).toEqual([]);
  });

  it("keeps conversation history across multiple messages", async () => {
    const token = await registerUserForCompany({
      name: "Alice",
      email: "alice@example.com",
      companyName: "Company A",
    });
    llmClient.createChatCompletion
      .mockResolvedValueOnce({
        message: { role: "assistant", content: "First answer" },
      })
      .mockResolvedValueOnce({
        message: { role: "assistant", content: "Second answer" },
      });

    await request(app).post("/api/chat").set("Authorization", `Bearer ${token}`).send({ message: "First question" });
    await request(app).post("/api/chat").set("Authorization", `Bearer ${token}`).send({ message: "Second question" });

    const response = await request(app).get("/api/chat").set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.messages).toHaveLength(4);
    expect(response.body.messages.map((message) => message.content)).toEqual([
      "First question",
      "First answer",
      "Second question",
      "Second answer",
    ]);
  });
});
