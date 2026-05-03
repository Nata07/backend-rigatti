import OpenAI from "openai";

import {
  LLMClient,
  type ChatCompletionInput,
  type ChatCompletionResult,
  type ChatCompletionStreamHandlers,
  type LLMMessage,
  type ToolCallResult,
} from "./LLMClient";

interface HttpError extends Error {
  statusCode: number;
  provider?: string;
  providerCode?: string;
  providerStatus?: number;
}

interface OpenAIClientInstance {
  chat: {
    completions: {
      create(payload: Record<string, unknown>): Promise<unknown>;
    };
  };
}

type OpenAIClientConstructor = new (options: { apiKey: string }) => OpenAIClientInstance;

interface OpenAIToolCallLike {
  id: string;
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenAIMessageLike {
  content?: unknown;
  tool_calls?: OpenAIToolCallLike[];
}

interface OpenAIChatCompletionLike {
  choices?: Array<{
    message?: OpenAIMessageLike;
  }>;
}

interface OpenAIChatCompletionChunkLike {
  choices?: Array<{
    delta?: OpenAIMessageLike;
  }>;
}

interface OpenAIStreamLike extends AsyncIterable<OpenAIChatCompletionChunkLike> {}

interface ProviderErrorMetadata {
  provider: string;
  providerCode?: string;
  providerStatus?: number;
}

function createHttpError(
  statusCode: number,
  message: string,
  metadata: ProviderErrorMetadata | Record<string, never> = {},
): HttpError {
  const error = new Error(message) as HttpError;
  error.statusCode = statusCode;
  Object.assign(error, metadata);
  return error;
}

export class OpenAIProvider extends LLMClient {
  private readonly client: OpenAIClientInstance;

  private readonly model: string;

  constructor({
    apiKey = process.env.OPENAI_API_KEY,
    model = "gpt-4o-mini",
    OpenAIClient = OpenAI as unknown as OpenAIClientConstructor,
  }: {
    apiKey?: string;
    model?: string;
    OpenAIClient?: OpenAIClientConstructor;
  } = {}) {
    super();

    if (!apiKey || !apiKey.trim()) {
      throw createHttpError(500, "OPENAI_API_KEY is required");
    }

    this.model = model;
    this.client = new OpenAIClient({ apiKey });
  }

  async createChatCompletion(input: ChatCompletionInput): Promise<ChatCompletionResult> {
    try {
      const response = (await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: "system",
            content: input.systemPrompt,
          },
          ...input.messages.map(mapMessageForOpenAI),
        ],
        tools: input.tools,
        ...(input.signal ? { signal: input.signal } : {}),
      })) as OpenAIChatCompletionLike;

      const assistantMessage = response.choices?.[0]?.message;
      const toolCalls = assistantMessage?.tool_calls?.map<ToolCallResult>((toolCall) => ({
        id: toolCall.id,
        name: toolCall.function.name,
        argumentsJson: toolCall.function.arguments,
      }));

      return {
        message: {
          role: "assistant",
          content: normalizeAssistantContent(assistantMessage?.content),
        },
        ...(toolCalls && toolCalls.length > 0 ? { toolCalls } : {}),
      };
    } catch (error) {
      throw mapProviderError(error);
    }
  }

  async streamChatCompletion(
    input: ChatCompletionInput,
    handlers: ChatCompletionStreamHandlers,
  ): Promise<ChatCompletionResult> {
    try {
      const stream = (await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: "system",
            content: input.systemPrompt,
          },
          ...input.messages.map(mapMessageForOpenAI),
        ],
        tools: input.tools,
        stream: true,
        ...(input.signal ? { signal: input.signal } : {}),
      })) as OpenAIStreamLike;

      const contentParts: string[] = [];
      const toolCallsByIndex = new Map<number, ToolCallResult>();

      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) {
          continue;
        }

        const content = normalizeAssistantContent(delta.content);
        if (content) {
          contentParts.push(content);
          if (handlers.onToken) {
            await handlers.onToken(content);
          }
        }

        if (Array.isArray(delta.tool_calls)) {
          for (const [index, toolCallDelta] of delta.tool_calls.entries()) {
            const existingToolCall = toolCallsByIndex.get(index) ?? {
              id: "",
              name: "",
              argumentsJson: "",
            };

            toolCallsByIndex.set(index, {
              id: toolCallDelta.id ?? existingToolCall.id,
              name: toolCallDelta.function?.name ?? existingToolCall.name,
              argumentsJson: `${existingToolCall.argumentsJson}${toolCallDelta.function?.arguments ?? ""}`,
            });
          }
        }
      }

      const toolCalls = Array.from(toolCallsByIndex.values()).filter(
        (toolCall) => toolCall.id && toolCall.name,
      );

      if (handlers.onToolCall) {
        for (const toolCall of toolCalls) {
          await handlers.onToolCall(toolCall);
        }
      }

      return {
        message: {
          role: "assistant",
          content: normalizeAssistantContent(contentParts.join("")),
        },
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      };
    } catch (error) {
      throw mapProviderError(error);
    }
  }
}

function mapMessageForOpenAI(message: LLMMessage): Record<string, unknown> {
  if (message.role === "tool") {
    return {
      role: "tool",
      content: message.content,
      tool_call_id: message.toolCallId,
    };
  }

  if (message.role === "assistant" && Array.isArray(message.toolCalls) && message.toolCalls.length > 0) {
    return {
      role: "assistant",
      content: message.content,
      tool_calls: message.toolCalls.map((toolCall) => ({
        id: toolCall.id,
        type: "function",
        function: {
          name: toolCall.name,
          arguments: toolCall.argumentsJson,
        },
      })),
      ...(message.name ? { name: message.name } : {}),
    };
  }

  return {
    role: message.role,
    content: message.content,
    ...(message.name ? { name: message.name } : {}),
  };
}

function normalizeAssistantContent(content: unknown): string | null {
  if (typeof content === "string" || content === null) {
    return content;
  }

  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        if (part && typeof part === "object" && "type" in part && part.type === "text") {
          const textPart = part as { text?: string };
          return textPart.text ?? "";
        }

        return "";
      })
      .join("")
      .trim();

    return text || null;
  }

  return null;
}

export function mapProviderError(error: unknown): HttpError {
  const metadata: ProviderErrorMetadata = {
    provider: "openai",
  };

  if (error && typeof error === "object") {
    const providerError = error as { code?: unknown; status?: unknown };

    if (typeof providerError.code === "string") {
      metadata.providerCode = providerError.code;
    }

    if (Number.isInteger(providerError.status)) {
      metadata.providerStatus = providerError.status as number;
    }
  }

  return createHttpError(502, "LLM provider request failed", metadata);
}
