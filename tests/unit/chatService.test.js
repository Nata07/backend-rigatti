const { createChatService } = require("../../src/services/chatService");

describe("chatService", () => {
  let conversationRepository;
  let llmClient;
  let toolExecutor;
  let chatService;

  beforeEach(() => {
    conversationRepository = {
      findByUserId: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    };
    llmClient = {
      createChatCompletion: jest.fn(),
      streamChatCompletion: jest.fn(),
    };
    toolExecutor = {
      executeToolCall: jest.fn(),
      getToolDefinitions: jest.fn(() => []),
    };
    chatService = createChatService({
      conversationRepository,
      llmClient,
      toolExecutor,
      systemPrompt: "You are a product assistant.",
    });
  });

  it("loads the existing conversation for the authenticated user", async () => {
    const conversation = createConversation({
      messages: [{ role: "assistant", content: "Previous reply", createdAt: new Date("2026-01-01T00:00:00.000Z") }],
    });
    const updatedConversation = createConversation({
      messages: [
        ...conversation.messages,
        { role: "user", content: "Find keyboards", createdAt: new Date("2026-01-02T00:00:00.000Z") },
        { role: "assistant", content: "Found keyboards.", createdAt: new Date("2026-01-02T00:00:01.000Z") },
      ],
    });

    conversationRepository.findByUserId.mockResolvedValue(conversation);
    llmClient.createChatCompletion.mockResolvedValue({
      message: { role: "assistant", content: "Found keyboards." },
    });
    conversationRepository.update.mockResolvedValue(updatedConversation);

    await chatService.processMessage({ message: "Find keyboards" }, authContext());

    expect(conversationRepository.findByUserId).toHaveBeenCalledWith("user-123", "company-123");
    expect(conversationRepository.create).not.toHaveBeenCalled();
  });

  it("creates a new conversation when none exists", async () => {
    const conversation = createConversation({ messages: [] });
    const updatedConversation = createConversation({
      messages: [
        { role: "user", content: "Hello", createdAt: new Date("2026-01-02T00:00:00.000Z") },
        { role: "assistant", content: "Hi there", createdAt: new Date("2026-01-02T00:00:01.000Z") },
      ],
    });

    conversationRepository.findByUserId.mockResolvedValue(null);
    conversationRepository.create.mockResolvedValue(conversation);
    llmClient.createChatCompletion.mockResolvedValue({
      message: { role: "assistant", content: "Hi there" },
    });
    conversationRepository.update.mockResolvedValue(updatedConversation);

    await chatService.processMessage({ message: "Hello" }, authContext());

    expect(conversationRepository.create).toHaveBeenCalledWith({
      userId: "user-123",
      companyId: "company-123",
      messages: [],
    });
  });

  it("adds the user message before calling the LLM", async () => {
    const conversation = createConversation({ messages: [] });

    conversationRepository.findByUserId.mockResolvedValue(conversation);
    llmClient.createChatCompletion.mockResolvedValue({
      message: { role: "assistant", content: "Response" },
    });
    conversationRepository.update.mockResolvedValue(
      createConversation({
        messages: [
          { role: "user", content: "Find keyboards", createdAt: new Date("2026-01-02T00:00:00.000Z") },
          { role: "assistant", content: "Response", createdAt: new Date("2026-01-02T00:00:01.000Z") },
        ],
      })
    );

    await chatService.processMessage({ message: "Find keyboards" }, authContext());

    expect(llmClient.createChatCompletion).toHaveBeenCalledWith({
      systemPrompt: "You are a product assistant.",
      messages: [{ role: "user", content: "Find keyboards" }],
      tools: [],
    });
  });

  it("adds the assistant message after the final response", async () => {
    const conversation = createConversation({ messages: [] });
    const updatedConversation = createConversation({
      messages: [
        { role: "user", content: "Find keyboards", createdAt: new Date("2026-01-02T00:00:00.000Z") },
        { role: "assistant", content: "Found one keyboard.", createdAt: new Date("2026-01-02T00:00:01.000Z") },
      ],
    });

    conversationRepository.findByUserId.mockResolvedValue(conversation);
    llmClient.createChatCompletion.mockResolvedValue({
      message: { role: "assistant", content: "Found one keyboard." },
    });
    conversationRepository.update.mockResolvedValue(updatedConversation);

    const result = await chatService.processMessage({ message: "Find keyboards" }, authContext());

    expect(conversationRepository.update).toHaveBeenCalledWith(
      "conversation-123",
      expect.objectContaining({
        userId: "user-123",
        companyId: "company-123",
        messages: expect.arrayContaining([
          expect.objectContaining({ role: "user", content: "Find keyboards" }),
          expect.objectContaining({ role: "assistant", content: "Found one keyboard." }),
        ]),
      })
    );
    expect(result.assistantMessage).toMatchObject({
      role: "assistant",
      content: "Found one keyboard.",
    });
  });

  it("runs the tool-calling loop and sends tool results back to the LLM", async () => {
    const conversation = createConversation({ messages: [] });

    conversationRepository.findByUserId.mockResolvedValue(conversation);
    llmClient.createChatCompletion
      .mockResolvedValueOnce({
        message: { role: "assistant", content: null },
        toolCalls: [{ id: "call-1", name: "search_products", argumentsJson: "{\"query\":\"keyboard\"}" }],
      })
      .mockResolvedValueOnce({
        message: { role: "assistant", content: "Found one keyboard." },
      });
    toolExecutor.getToolDefinitions.mockReturnValue([{ type: "function" }]);
    toolExecutor.executeToolCall.mockResolvedValue({
      role: "tool",
      toolCallId: "call-1",
      name: "search_products",
      content: "[{\"id\":\"product-1\",\"name\":\"Keyboard\"}]",
    });
    conversationRepository.update.mockResolvedValue(
      createConversation({
        messages: [
          { role: "user", content: "Find keyboards", createdAt: new Date("2026-01-02T00:00:00.000Z") },
          { role: "assistant", content: "Found one keyboard.", createdAt: new Date("2026-01-02T00:00:01.000Z") },
        ],
      })
    );

    await chatService.processMessage({ message: "Find keyboards" }, authContext());

    expect(toolExecutor.executeToolCall).toHaveBeenCalledWith(
      { id: "call-1", name: "search_products", argumentsJson: "{\"query\":\"keyboard\"}" },
      authContext()
    );
    expect(llmClient.createChatCompletion).toHaveBeenCalledTimes(2);
    expect(llmClient.createChatCompletion.mock.calls[1][0]).toMatchObject({
      messages: [
        { role: "user", content: "Find keyboards" },
        {
          role: "assistant",
          content: null,
          toolCalls: [{ id: "call-1", name: "search_products", argumentsJson: "{\"query\":\"keyboard\"}" }],
        },
        {
          role: "tool",
          toolCallId: "call-1",
          name: "search_products",
          content: "[{\"id\":\"product-1\",\"name\":\"Keyboard\"}]",
        },
      ],
    });
  });

  it("maps provider failures through the chat service", async () => {
    conversationRepository.findByUserId.mockResolvedValue(createConversation({ messages: [] }));
    llmClient.createChatCompletion.mockRejectedValue(
      Object.assign(new Error("LLM provider request failed"), { statusCode: 502, provider: "openai" })
    );

    await expect(chatService.processMessage({ message: "Find keyboards" }, authContext())).rejects.toMatchObject({
      statusCode: 502,
      message: "LLM provider request failed",
      provider: "openai",
    });
  });

  it("returns the active conversation and creates one when needed", async () => {
    const createdConversation = createConversation({ messages: [] });

    conversationRepository.findByUserId.mockResolvedValueOnce(null);
    conversationRepository.create.mockResolvedValue(createdConversation);

    const result = await chatService.getActiveConversation(authContext());

    expect(result).toMatchObject({
      _id: "conversation-123",
      userId: "user-123",
      companyId: "company-123",
      messages: [],
    });
    expect(conversationRepository.create).toHaveBeenCalledWith({
      userId: "user-123",
      companyId: "company-123",
      messages: [],
    });
  });

  it("rejects an empty chat message", async () => {
    await expect(chatService.processMessage({ message: "   " }, authContext())).rejects.toMatchObject({
      statusCode: 400,
      message: "message is required",
    });
  });

  it("falls back to a safe assistant message when the provider returns no content", async () => {
    const conversation = createConversation({ messages: [] });
    const updatedConversation = createConversation({
      messages: [
        { role: "user", content: "Find keyboards", createdAt: new Date("2026-01-02T00:00:00.000Z") },
        {
          role: "assistant",
          content: "I could not find enough information to answer that.",
          createdAt: new Date("2026-01-02T00:00:01.000Z"),
        },
      ],
    });

    conversationRepository.findByUserId.mockResolvedValue(conversation);
    llmClient.createChatCompletion.mockResolvedValue({
      message: { role: "assistant", content: null },
    });
    conversationRepository.update.mockResolvedValue(updatedConversation);

    const result = await chatService.processMessage({ message: "Find keyboards" }, authContext());

    expect(result.assistantMessage.content).toBe("I could not find enough information to answer that.");
  });

  it("returns 500 when the conversation update does not persist", async () => {
    conversationRepository.findByUserId.mockResolvedValue(createConversation({ messages: [] }));
    llmClient.createChatCompletion.mockResolvedValue({
      message: { role: "assistant", content: "Response" },
    });
    conversationRepository.update.mockResolvedValue(null);

    await expect(chatService.processMessage({ message: "Find keyboards" }, authContext())).rejects.toMatchObject({
      statusCode: 500,
      message: "Conversation could not be updated",
    });
  });

  it("streams chat tokens, tool events and persists the final assistant message", async () => {
    const conversation = createConversation({ messages: [] });
    const updatedConversation = createConversation({
      messages: [
        { role: "user", content: "Find keyboards", createdAt: new Date("2026-01-02T00:00:00.000Z") },
        { role: "assistant", content: "Found one keyboard.", createdAt: new Date("2026-01-02T00:00:02.000Z") },
      ],
    });
    const onToken = jest.fn();
    const onToolCall = jest.fn();
    const onToolResult = jest.fn();

    conversationRepository.findByUserId.mockResolvedValue(conversation);
    llmClient.streamChatCompletion
      .mockImplementationOnce(async (_input, handlers) => {
        await handlers.onToolCall({
          id: "call-1",
          name: "search_products",
          argumentsJson: "{\"query\":\"keyboard\"}",
        });

        return {
          message: { role: "assistant", content: null },
          toolCalls: [{ id: "call-1", name: "search_products", argumentsJson: "{\"query\":\"keyboard\"}" }],
        };
      })
      .mockImplementationOnce(async (_input, handlers) => {
        await handlers.onToken("Found one keyboard.");

        return {
          message: { role: "assistant", content: "Found one keyboard." },
        };
      });
    toolExecutor.getToolDefinitions.mockReturnValue([{ type: "function" }]);
    toolExecutor.executeToolCall.mockResolvedValue({
      role: "tool",
      toolCallId: "call-1",
      name: "search_products",
      content: "[{\"id\":\"product-1\",\"name\":\"Keyboard\"}]",
    });
    conversationRepository.update.mockResolvedValue(updatedConversation);

    const result = await chatService.streamChatCompletion(
      { message: "Find keyboards" },
      authContext(),
      { onToken, onToolCall, onToolResult }
    );

    expect(llmClient.streamChatCompletion).toHaveBeenCalledTimes(2);
    expect(onToolCall).toHaveBeenCalledWith({
      id: "call-1",
      name: "search_products",
      argumentsJson: "{\"query\":\"keyboard\"}",
    });
    expect(onToolResult).toHaveBeenCalledWith({
      toolCallId: "call-1",
      name: "search_products",
      content: "[{\"id\":\"product-1\",\"name\":\"Keyboard\"}]",
    });
    expect(conversationRepository.update).toHaveBeenCalledWith(
      "conversation-123",
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({ role: "user", content: "Find keyboards" }),
          expect.objectContaining({ role: "assistant", content: "Found one keyboard." }),
        ]),
      })
    );
    expect(result.assistantMessage.content).toBe("Found one keyboard.");
  });
});

function authContext() {
  return {
    userId: "user-123",
    companyId: "company-123",
    role: "user",
  };
}

function createConversation({ messages }) {
  return {
    _id: "conversation-123",
    userId: "user-123",
    companyId: "company-123",
    messages,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    toObject() {
      return {
        _id: this._id,
        userId: this.userId,
        companyId: this.companyId,
        messages: this.messages,
        createdAt: this.createdAt,
        updatedAt: this.updatedAt,
      };
    },
  };
}
