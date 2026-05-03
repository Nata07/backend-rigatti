export interface ToolCallResult {
  id: string;
  name: string;
  argumentsJson: string;
}

export interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  toolCallId?: string;
  name?: string;
  toolCalls?: ToolCallResult[];
}

export interface LLMToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required: string[];
    };
  };
}

export interface ChatCompletionInput {
  systemPrompt: string;
  messages: LLMMessage[];
  tools: LLMToolDefinition[];
  signal?: AbortSignal;
}

export interface ChatCompletionResult {
  message: {
    role: "assistant";
    content: string | null;
  };
  toolCalls?: ToolCallResult[];
}

export interface ChatCompletionStreamHandlers {
  onToken?(token: string): void | Promise<void>;
  onToolCall?(toolCall: ToolCallResult): void | Promise<void>;
}

export class LLMClient {
  async createChatCompletion(_input: ChatCompletionInput): Promise<ChatCompletionResult> {
    throw new Error("LLMClient#createChatCompletion must be implemented by a provider");
  }

  async streamChatCompletion(
    _input: ChatCompletionInput,
    _handlers: ChatCompletionStreamHandlers,
  ): Promise<ChatCompletionResult> {
    throw new Error("LLMClient#streamChatCompletion must be implemented by a provider");
  }
}
