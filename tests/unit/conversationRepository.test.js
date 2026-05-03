const { createConversationRepository } = require("../../src/repositories/conversationRepository");

describe("conversationRepository", () => {
  let ConversationModel;
  let repository;

  beforeEach(() => {
    ConversationModel = {
      create: jest.fn(),
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
    };
    repository = createConversationRepository({ ConversationModel });
  });

  it("finds the active conversation by userId and companyId", async () => {
    ConversationModel.findOne.mockResolvedValue({ _id: "conversation-1" });

    const result = await repository.findByUserId("user-123", "company-123");

    expect(ConversationModel.findOne).toHaveBeenCalledWith({
      userId: "user-123",
      companyId: "company-123",
    });
    expect(result).toEqual({ _id: "conversation-1" });
  });

  it("creates a conversation with an empty message list by default", async () => {
    ConversationModel.create.mockResolvedValue({ _id: "conversation-1" });

    await repository.create({
      userId: "user-123",
      companyId: "company-123",
    });

    expect(ConversationModel.create).toHaveBeenCalledWith({
      userId: "user-123",
      companyId: "company-123",
      messages: [],
    });
  });

  it("updates a conversation within the user and tenant scope", async () => {
    ConversationModel.findOneAndUpdate.mockResolvedValue({ _id: "conversation-1" });
    const messages = [{ role: "assistant", content: "Hello", createdAt: new Date("2026-01-01T00:00:00.000Z") }];

    const result = await repository.update("conversation-1", {
      userId: "user-123",
      companyId: "company-123",
      messages,
    });

    expect(ConversationModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: "conversation-1", userId: "user-123", companyId: "company-123" },
      { messages, companyId: "company-123", userId: "user-123" },
      { new: true, runValidators: true },
    );
    expect(result).toEqual({ _id: "conversation-1" });
  });
});
