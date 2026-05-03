jest.mock("../../src/services/llm/OpenAIProvider", () => ({
  OpenAIProvider: jest.fn(),
}));

const { OpenAIProvider } = require("../../src/services/llm/OpenAIProvider");
const { createLLMClient } = require("../../src/config/llm");

describe("createLLMClient", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("creates an OpenAI provider with the configured api key and default model", () => {
    createLLMClient({ apiKey: "test-openai-key" });

    expect(OpenAIProvider).toHaveBeenCalledWith({
      apiKey: "test-openai-key",
      model: "gpt-4o-mini",
    });
  });

  it("allows overriding the model explicitly", () => {
    createLLMClient({
      apiKey: "test-openai-key",
      model: "gpt-4.1-mini",
    });

    expect(OpenAIProvider).toHaveBeenCalledWith({
      apiKey: "test-openai-key",
      model: "gpt-4.1-mini",
    });
  });
});
