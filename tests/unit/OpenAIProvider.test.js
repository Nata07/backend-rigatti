const { LLMClient } = require("../../src/services/llm/LLMClient");
const { OpenAIProvider } = require("../../src/services/llm/OpenAIProvider");

describe("OpenAIProvider", () => {
  let create;
  let OpenAIClient;

  beforeEach(() => {
    create = jest.fn();
    OpenAIClient = jest.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create,
        },
      },
    }));
  });

  it("implements the LLMClient contract", () => {
    const provider = new OpenAIProvider({
      apiKey: "test-openai-key",
      OpenAIClient,
    });

    expect(provider).toBeInstanceOf(LLMClient);
  });

  it("calls the OpenAI SDK with system prompt, messages and tools", async () => {
    create.mockResolvedValue({
      choices: [
        {
          message: {
            content: "Found one product.",
          },
        },
      ],
    });

    const provider = new OpenAIProvider({
      apiKey: "test-openai-key",
      model: "gpt-test",
      OpenAIClient,
    });

    await provider.createChatCompletion({
      systemPrompt: "You are a product assistant.",
      messages: [
        { role: "user", content: "Find keyboards" },
        { role: "tool", content: "[{\"name\":\"Keyboard\"}]", toolCallId: "call_123" },
      ],
      tools: [{ type: "function", function: { name: "search_products" } }],
    });

    expect(OpenAIClient).toHaveBeenCalledWith({ apiKey: "test-openai-key" });
    expect(create).toHaveBeenCalledWith({
      model: "gpt-test",
      messages: [
        { role: "system", content: "You are a product assistant." },
        { role: "user", content: "Find keyboards" },
        { role: "tool", content: "[{\"name\":\"Keyboard\"}]", tool_call_id: "call_123" },
      ],
      tools: [{ type: "function", function: { name: "search_products" } }],
    });
  });

  it("maps tool-call responses into the internal adapter format", async () => {
    create.mockResolvedValue({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: "call_123",
                function: {
                  name: "search_products",
                  arguments: "{\"query\":\"keyboard\",\"limit\":3}",
                },
              },
            ],
          },
        },
      ],
    });

    const provider = new OpenAIProvider({
      apiKey: "test-openai-key",
      OpenAIClient,
    });

    await expect(
      provider.createChatCompletion({
        systemPrompt: "You are a product assistant.",
        messages: [{ role: "user", content: "Find keyboards" }],
        tools: [{ type: "function", function: { name: "search_products" } }],
      })
    ).resolves.toEqual({
      message: {
        role: "assistant",
        content: null,
      },
      toolCalls: [
        {
          id: "call_123",
          name: "search_products",
          argumentsJson: "{\"query\":\"keyboard\",\"limit\":3}",
        },
      ],
    });
  });

  it("maps provider failures to a sanitized 502 error", async () => {
    const providerError = new Error("401 Invalid API key sk-secret");
    providerError.status = 401;
    providerError.code = "invalid_api_key";
    create.mockRejectedValue(providerError);

    const provider = new OpenAIProvider({
      apiKey: "test-openai-key",
      OpenAIClient,
    });

    await expect(
      provider.createChatCompletion({
        systemPrompt: "You are a product assistant.",
        messages: [{ role: "user", content: "Find keyboards" }],
        tools: [],
      })
    ).rejects.toMatchObject({
      statusCode: 502,
      message: "LLM provider request failed",
      provider: "openai",
      providerCode: "invalid_api_key",
      providerStatus: 401,
    });
  });

  it("requires an API key", () => {
    expect(
      () =>
        new OpenAIProvider({
          apiKey: "   ",
          OpenAIClient,
        })
    ).toThrow("OPENAI_API_KEY is required");
  });

  it("normalizes array-based assistant content and optional message names", async () => {
    create.mockResolvedValue({
      choices: [
        {
          message: {
            content: [{ type: "text", text: "Found " }, "two products."],
          },
        },
      ],
    });

    const provider = new OpenAIProvider({
      apiKey: "test-openai-key",
      OpenAIClient,
    });

    await expect(
      provider.createChatCompletion({
        systemPrompt: "You are a product assistant.",
        messages: [{ role: "assistant", content: "Previous answer", name: "catalog-agent" }],
        tools: [],
      })
    ).resolves.toEqual({
      message: {
        role: "assistant",
        content: "Found two products.",
      },
    });

    expect(create).toHaveBeenCalledWith({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a product assistant." },
        { role: "assistant", content: "Previous answer", name: "catalog-agent" },
      ],
      tools: [],
    });
  });

  it("preserves assistant tool calls when sending the follow-up completion", async () => {
    create.mockResolvedValue({
      choices: [
        {
          message: {
            content: "Done.",
          },
        },
      ],
    });

    const provider = new OpenAIProvider({
      apiKey: "test-openai-key",
      OpenAIClient,
    });

    await provider.createChatCompletion({
      systemPrompt: "You are a product assistant.",
      messages: [
        {
          role: "assistant",
          content: null,
          toolCalls: [{ id: "call_123", name: "search_products", argumentsJson: "{\"query\":\"keyboard\"}" }],
        },
        {
          role: "tool",
          content: "[{\"name\":\"Keyboard\"}]",
          toolCallId: "call_123",
        },
      ],
      tools: [],
    });

    expect(create).toHaveBeenCalledWith({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a product assistant." },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_123",
              type: "function",
              function: {
                name: "search_products",
                arguments: "{\"query\":\"keyboard\"}",
              },
            },
          ],
        },
        { role: "tool", content: "[{\"name\":\"Keyboard\"}]", tool_call_id: "call_123" },
      ],
      tools: [],
    });
  });

  it("falls back to null when assistant content is not a supported shape", async () => {
    create.mockResolvedValue({
      choices: [
        {
          message: {
            content: { type: "refusal" },
          },
        },
      ],
    });

    const provider = new OpenAIProvider({
      apiKey: "test-openai-key",
      OpenAIClient,
    });

    await expect(
      provider.createChatCompletion({
        systemPrompt: "You are a product assistant.",
        messages: [{ role: "user", content: "Find keyboards" }],
        tools: [],
      })
    ).resolves.toEqual({
      message: {
        role: "assistant",
        content: null,
      },
    });
  });

  it("streams tokens and tool calls from the OpenAI SDK", async () => {
    create.mockResolvedValue(
      createStream([
        {
          choices: [
            {
              delta: {
                content: "Found ",
              },
            },
          ],
        },
        {
          choices: [
            {
              delta: {
                content: "products",
              },
            },
          ],
        },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    id: "call_123",
                    function: {
                      name: "search_products",
                      arguments: "{\"query\":\"key",
                    },
                  },
                ],
              },
            },
          ],
        },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    function: {
                      arguments: "board\"}",
                    },
                  },
                ],
              },
            },
          ],
        },
      ])
    );

    const provider = new OpenAIProvider({
      apiKey: "test-openai-key",
      OpenAIClient,
    });
    const onToken = jest.fn();
    const onToolCall = jest.fn();

    await expect(
      provider.streamChatCompletion(
        {
          systemPrompt: "You are a product assistant.",
          messages: [{ role: "user", content: "Find keyboards" }],
          tools: [{ type: "function", function: { name: "search_products" } }],
        },
        { onToken, onToolCall }
      )
    ).resolves.toEqual({
      message: {
        role: "assistant",
        content: "Found products",
      },
      toolCalls: [
        {
          id: "call_123",
          name: "search_products",
          argumentsJson: "{\"query\":\"keyboard\"}",
        },
      ],
    });

    expect(create).toHaveBeenCalledWith({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a product assistant." },
        { role: "user", content: "Find keyboards" },
      ],
      tools: [{ type: "function", function: { name: "search_products" } }],
      stream: true,
    });
    expect(onToken).toHaveBeenNthCalledWith(1, "Found ");
    expect(onToken).toHaveBeenNthCalledWith(2, "products");
    expect(onToolCall).toHaveBeenCalledWith({
      id: "call_123",
      name: "search_products",
      argumentsJson: "{\"query\":\"keyboard\"}",
    });
  });
});

function createStream(chunks) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield chunk;
      }
    },
  };
}
