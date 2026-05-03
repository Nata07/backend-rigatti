import { ZodError, z } from "zod";

import type { AuthContext } from "../types/auth";
import type { LLMToolDefinition, ToolCallResult } from "./llm/LLMClient";
import {
  createProductSearchService,
  type ProductSearchResult,
  type ProductSearchService,
} from "./productSearchService";

interface HttpError extends Error {
  statusCode: number;
}

export interface SearchProductsToolArguments {
  query?: string | undefined;
  category?: string | undefined;
  limit?: number | undefined;
}

export interface ResolvedSearchProductsToolArguments {
  query?: string | undefined;
  category?: string | undefined;
  limit: number;
}

export interface ToolCall extends ToolCallResult {}

export interface ToolMessage {
  role: "tool";
  toolCallId: string;
  name: string;
  content: string;
}

export interface ToolExecutor {
  executeToolCall(toolCall: ToolCall, authContext: Pick<AuthContext, "companyId">): Promise<ToolMessage>;
  getToolDefinitions(): readonly LLMToolDefinition[];
  validateSearchProductsArguments(input: unknown): ResolvedSearchProductsToolArguments;
}

const searchProductsArgumentsSchema = z
  .object({
    query: z.preprocess((value) => (value == null ? "" : value), z.string().trim()).optional(),
    category: z.string().trim().min(1, "category cannot be empty").optional(),
    limit: z.preprocess(
      (value) => {
        if (value == null) {
          return 10;
        }

        const parsedLimit = Number(value);
        if (Number.isNaN(parsedLimit) || parsedLimit < 1) {
          return 10;
        }

        if (parsedLimit > 50) {
          return 50;
        }

        return parsedLimit;
      },
      z.number().int().min(1).max(50).default(10),
    ),
  })
  .strict();

const toolDefinitions: readonly LLMToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "search_products",
      description: "Search products in the company catalog. Use empty query to list all products.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query (optional, leave empty to list all products)" },
          category: { type: "string", description: "Filter by category" },
          limit: { type: "number", description: "Max results (default: 10, max: 50)" },
        },
        required: [],
      },
    },
  },
];

function createHttpError(statusCode: number, message: string): HttpError {
  const error = new Error(message) as HttpError;
  error.statusCode = statusCode;
  return error;
}

export function createToolExecutor({
  productSearchService = createProductSearchService(),
}: {
  productSearchService?: ProductSearchService;
}): ToolExecutor {
  async function executeToolCall(
    toolCall: ToolCall,
    authContext: Pick<AuthContext, "companyId">,
  ): Promise<ToolMessage> {
    if (toolCall.name !== "search_products") {
      throw createHttpError(400, "Unknown tool");
    }

    const argumentsInput = parseToolArguments(toolCall.argumentsJson);
    const validatedArguments = validateSearchProductsArguments(argumentsInput);
    const results: ProductSearchResult[] = await productSearchService.searchForCompany({
      companyId: authContext.companyId,
      ...validatedArguments,
    });

    return {
      role: "tool",
      toolCallId: toolCall.id,
      name: toolCall.name,
      content: JSON.stringify(results),
    };
  }

  return {
    executeToolCall,
    getToolDefinitions() {
      return toolDefinitions;
    },
    validateSearchProductsArguments,
  };
}

function parseToolArguments(argumentsJson: string): unknown {
  try {
    return JSON.parse(argumentsJson || "{}") as unknown;
  } catch {
    throw createHttpError(400, "Tool arguments must be valid JSON");
  }
}

export function validateSearchProductsArguments(input: unknown): ResolvedSearchProductsToolArguments {
  try {
    return searchProductsArgumentsSchema.parse(input);
  } catch (error) {
    if (error instanceof ZodError) {
      throw createHttpError(400, error.issues[0]?.message ?? "Invalid tool arguments");
    }

    throw error;
  }
}
