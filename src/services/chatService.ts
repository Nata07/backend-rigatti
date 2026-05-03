import { ZodError, z } from "zod";

import { MessageRole as ConversationMessageRole } from "../models";
import { createConversationRepository, type ConversationRepository } from "../repositories/conversationRepository";
import type { AuthContext } from "../types/auth";
import type { StreamToolCallEvent, StreamToolResultEvent } from "../types/stream";
import type { LLMClient, LLMMessage, ToolCallResult } from "./llm/LLMClient";
import type { ToolExecutor, ToolMessage } from "./toolExecutor";

const { systemPrompt: defaultSystemPrompt } = require("../config/systemPrompt") as { systemPrompt: string };

interface HttpError extends Error {
  statusCode: number;
  provider?: string;
}

interface ObjectIdLike {
  toString(): string;
}

export interface StoredConversationMessage {
  role: ConversationMessageRole.User | ConversationMessageRole.Assistant;
  content: string;
  createdAt: Date;
}

interface ConversationDocumentMessage {
  role: ConversationMessageRole.User | ConversationMessageRole.Assistant;
  content: string;
  createdAt: Date | string;
}

interface ConversationDocument {
  _id: ObjectIdLike | string;
  userId: ObjectIdLike | string;
  companyId: ObjectIdLike | string;
  messages: ConversationDocumentMessage[];
  createdAt: Date;
  updatedAt: Date;
  toObject?(): ConversationDocument;
}

export interface SerializedConversation {
  _id: string;
  userId: string;
  companyId: string;
  messages: StoredConversationMessage[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatMessageInput {
  message: string;
}

export interface ChatServiceResult {
  conversation: SerializedConversation;
  assistantMessage: StoredConversationMessage;
}

export interface StreamChatCompletionCallbacks {
  onToken?(token: string): void | Promise<void>;
  onToolCall?(event: StreamToolCallEvent): void | Promise<void>;
  onToolResult?(event: StreamToolResultEvent): void | Promise<void>;
}

export interface ChatService {
  getActiveConversation(authContext: AuthContext): Promise<SerializedConversation>;
  processMessage(input: unknown, authContext: AuthContext): Promise<ChatServiceResult>;
  streamChatCompletion(
    input: unknown,
    authContext: AuthContext,
    callbacks: StreamChatCompletionCallbacks,
    options?: { signal?: AbortSignal },
  ): Promise<ChatServiceResult>;
}

export interface ChatServiceDependencies {
  conversationRepository?: ConversationRepository;
  llmClient: LLMClient;
  toolExecutor: ToolExecutor;
  systemPrompt?: string;
  historyMessageLimit?: number;
}

interface LLMCompletionWithTools {
  message: {
    role: "assistant";
    content: string | null;
  };
  toolCalls?: ToolCallResult[];
}

const chatMessageSchema = z.object({
  message: z.string().trim().min(1, "message is required"),
});

function createHttpError(statusCode: number, message: string): HttpError {
  const error = new Error(message) as HttpError;
  error.statusCode = statusCode;
  return error;
}

function toEntityId(value: ObjectIdLike | string): string {
  return typeof value === "string" ? value : value.toString();
}

export function createChatService({
  conversationRepository = createConversationRepository(),
  llmClient,
  toolExecutor,
  systemPrompt = defaultSystemPrompt,
  historyMessageLimit = 20,
}: ChatServiceDependencies): ChatService {
  async function getActiveConversation(authContext: AuthContext): Promise<SerializedConversation> {
    const conversation = await getOrCreateConversation(authContext);
    return serializeConversation(conversation);
  }

  async function processMessage(input: unknown, authContext: AuthContext): Promise<ChatServiceResult> {
    const { message } = validateChatMessageInput(input);
    const conversation = await getOrCreateConversation(authContext);
    const userMessage = createStoredMessage(ConversationMessageRole.User, message);
    const persistedMessages = [...conversation.messages.map(toPlainStoredMessage), userMessage];
    const conversationMessages = buildConversationMessages(persistedMessages, historyMessageLimit);
    const tools = toolExecutor.getToolDefinitions();

    const initialCompletion = await llmClient.createChatCompletion({
      systemPrompt,
      messages: conversationMessages,
      tools: [...tools],
    });

    const assistantMessage = await resolveAssistantMessage({
      initialCompletion,
      conversationMessages,
      authContext,
      llmClient,
      systemPrompt,
      toolExecutor,
      tools,
    });

    const updatedConversation = await conversationRepository.update(toEntityId(conversation._id), {
      userId: authContext.userId,
      companyId: authContext.companyId,
      messages: [...persistedMessages, assistantMessage],
    });

    if (!updatedConversation) {
      throw createHttpError(500, "Conversation could not be updated");
    }

    return {
      conversation: serializeConversation(updatedConversation as unknown as ConversationDocument),
      assistantMessage,
    };
  }

  async function streamChatCompletion(
    input: unknown,
    authContext: AuthContext,
    callbacks: StreamChatCompletionCallbacks,
    options: { signal?: AbortSignal } = {},
  ): Promise<ChatServiceResult> {
    const { message } = validateChatMessageInput(input);
    const conversation = await getOrCreateConversation(authContext);
    const userMessage = createStoredMessage(ConversationMessageRole.User, message);
    const persistedMessages = [...conversation.messages.map(toPlainStoredMessage), userMessage];
    const conversationMessages = buildConversationMessages(persistedMessages, historyMessageLimit);
    const tools = toolExecutor.getToolDefinitions();

    const initialCompletion = await llmClient.streamChatCompletion(
      {
        systemPrompt,
        messages: conversationMessages,
        tools: [...tools],
        ...(options.signal ? { signal: options.signal } : {}),
      },
      {
        ...(callbacks.onToken ? { onToken: callbacks.onToken } : {}),
        onToolCall: async (toolCall) => {
          if (callbacks.onToolCall) {
            await callbacks.onToolCall({
              id: toolCall.id,
              name: toolCall.name,
              argumentsJson: toolCall.argumentsJson,
            });
          }
        },
      },
    );

    const assistantMessage = await resolveAssistantMessageStreaming({
      initialCompletion,
      conversationMessages,
      authContext,
      llmClient,
      systemPrompt,
      toolExecutor,
      tools,
      callbacks,
      ...(options.signal ? { signal: options.signal } : {}),
    });

    const updatedConversation = await conversationRepository.update(toEntityId(conversation._id), {
      userId: authContext.userId,
      companyId: authContext.companyId,
      messages: [...persistedMessages, assistantMessage],
    });

    if (!updatedConversation) {
      throw createHttpError(500, "Conversation could not be updated");
    }

    return {
      conversation: serializeConversation(updatedConversation as unknown as ConversationDocument),
      assistantMessage,
    };
  }

  async function getOrCreateConversation(authContext: AuthContext): Promise<ConversationDocument> {
    const existingConversation = await conversationRepository.findByUserId(
      authContext.userId,
      authContext.companyId,
    );

    if (existingConversation) {
      return existingConversation as unknown as ConversationDocument;
    }

    return (await conversationRepository.create({
      userId: authContext.userId,
      companyId: authContext.companyId,
      messages: [],
    })) as unknown as ConversationDocument;
  }

  return {
    getActiveConversation,
    processMessage,
    streamChatCompletion,
  };
}

async function resolveAssistantMessage({
  initialCompletion,
  conversationMessages,
  authContext,
  llmClient,
  systemPrompt,
  toolExecutor,
  tools,
}: {
  initialCompletion: LLMCompletionWithTools;
  conversationMessages: LLMMessage[];
  authContext: AuthContext;
  llmClient: LLMClient;
  systemPrompt: string;
  toolExecutor: ToolExecutor;
  tools: ReturnType<ToolExecutor["getToolDefinitions"]>;
}): Promise<StoredConversationMessage> {
  if (!initialCompletion.toolCalls?.length) {
    return createStoredMessage(
      ConversationMessageRole.Assistant,
      normalizeAssistantContent(initialCompletion.message.content),
    );
  }

  const toolMessages: ToolMessage[] = [];
  for (const toolCall of initialCompletion.toolCalls) {
    toolMessages.push(await toolExecutor.executeToolCall(toolCall, authContext));
  }

  const finalCompletion = await llmClient.createChatCompletion({
    systemPrompt,
    messages: [
      ...conversationMessages,
      {
        role: "assistant",
        content: initialCompletion.message.content,
        toolCalls: initialCompletion.toolCalls,
      },
      ...toolMessages,
    ],
    tools: [...tools],
  });

  return createStoredMessage(
    ConversationMessageRole.Assistant,
    normalizeAssistantContent(finalCompletion.message.content),
  );
}

async function resolveAssistantMessageStreaming({
  initialCompletion,
  conversationMessages,
  authContext,
  llmClient,
  systemPrompt,
  toolExecutor,
  tools,
  callbacks,
  signal,
}: {
  initialCompletion: LLMCompletionWithTools;
  conversationMessages: LLMMessage[];
  authContext: AuthContext;
  llmClient: LLMClient;
  systemPrompt: string;
  toolExecutor: ToolExecutor;
  tools: ReturnType<ToolExecutor["getToolDefinitions"]>;
  callbacks: StreamChatCompletionCallbacks;
  signal?: AbortSignal;
}): Promise<StoredConversationMessage> {
  if (!initialCompletion.toolCalls?.length) {
    return createStoredMessage(
      ConversationMessageRole.Assistant,
      normalizeAssistantContent(initialCompletion.message.content),
    );
  }

  const toolMessages: ToolMessage[] = [];
  for (const toolCall of initialCompletion.toolCalls) {
    const toolMessage = await toolExecutor.executeToolCall(toolCall, authContext);
    toolMessages.push(toolMessage);

    if (callbacks.onToolResult) {
      await callbacks.onToolResult({
        toolCallId: toolMessage.toolCallId,
        name: toolMessage.name,
        content: toolMessage.content,
      });
    }
  }

  const finalCompletion = await llmClient.streamChatCompletion(
    {
      systemPrompt,
      messages: [
        ...conversationMessages,
        {
          role: "assistant",
          content: initialCompletion.message.content,
          toolCalls: initialCompletion.toolCalls,
        },
        ...toolMessages,
      ],
      tools: [...tools],
      ...(signal ? { signal } : {}),
    },
    {
      ...(callbacks.onToken ? { onToken: callbacks.onToken } : {}),
    },
  );

  return createStoredMessage(
    ConversationMessageRole.Assistant,
    normalizeAssistantContent(finalCompletion.message.content),
  );
}

export function validateChatMessageInput(input: unknown): ChatMessageInput {
  try {
    return chatMessageSchema.parse(input);
  } catch (error) {
    if (error instanceof ZodError) {
      throw createHttpError(400, error.issues[0]?.message ?? "Invalid message");
    }

    throw error;
  }
}

function buildConversationMessages(
  messages: StoredConversationMessage[],
  historyMessageLimit: number,
): LLMMessage[] {
  return messages.slice(-historyMessageLimit).map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

function createStoredMessage(
  role: StoredConversationMessage["role"],
  content: string,
): StoredConversationMessage {
  return {
    role,
    content,
    createdAt: new Date(),
  };
}

function normalizeAssistantContent(content: string | null): string {
  return typeof content === "string" && content.trim()
    ? content.trim()
    : "I could not find enough information to answer that.";
}

function toPlainStoredMessage(message: ConversationDocumentMessage): StoredConversationMessage {
  return {
    role: message.role,
    content: message.content,
    createdAt: message.createdAt instanceof Date ? message.createdAt : new Date(message.createdAt),
  };
}

export function serializeConversation(conversation: ConversationDocument): SerializedConversation {
  const serialized = typeof conversation.toObject === "function" ? conversation.toObject() : conversation;

  return {
    _id: toEntityId(serialized._id),
    userId: toEntityId(serialized.userId),
    companyId: toEntityId(serialized.companyId),
    messages: serialized.messages.map((message) => ({
      role: message.role,
      content: message.content,
      createdAt: message.createdAt instanceof Date ? message.createdAt : new Date(message.createdAt),
    })),
    createdAt: serialized.createdAt,
    updatedAt: serialized.updatedAt,
  };
}
