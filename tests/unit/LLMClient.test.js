const { LLMClient } = require("../../src/services/llm/LLMClient");

describe("LLMClient", () => {
  it("throws when the base interface method is used directly", async () => {
    const client = new LLMClient();

    await expect(
      client.createChatCompletion({
        systemPrompt: "system",
        messages: [],
        tools: [],
      })
    ).rejects.toThrow("LLMClient#createChatCompletion must be implemented by a provider");
  });
});
