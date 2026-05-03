import type { AuthContext, JwtClaims, User, UserRole } from "../../src/types/auth";
import type { Conversation, Message } from "../../src/types/chat";
import type { EntityId, ISODateString, Nullable, Timestamped } from "../../src/types/common";
import type { Product, ProductInput } from "../../src/types/product";
import { Types } from "mongoose";
import type { AuthResponse, LoginUserInput, RegisterUserInput } from "../../src/services/authService";
import type { ChatService, ChatServiceResult, SerializedConversation } from "../../src/services/chatService";
import { LLMClient, type ChatCompletionInput, type ChatCompletionResult } from "../../src/services/llm/LLMClient";
import { OpenAIProvider } from "../../src/services/llm/OpenAIProvider";
import type { ConversationRepository } from "../../src/repositories/conversationRepository";
import type { ProductRepository } from "../../src/repositories/productRepository";
import type { ProductSearchResult, ProductSearchService } from "../../src/services/productSearchService";
import type { ToolExecutor, ToolMessage } from "../../src/services/toolExecutor";
import {
  Company,
  Conversation as ConversationModel,
  type ICompany,
  type IConversation,
  type IMessage,
  type IProduct,
  type IUser,
  MessageRole,
  Product as ProductModel,
  User as UserModel,
  UserRole as ModelUserRole,
} from "../../src/models";

const companyId: EntityId = "company-1";
const userId: EntityId = "user-1";

const authContext: AuthContext = {
  userId,
  companyId,
  role: "admin",
};

const claims: JwtClaims = {
  ...authContext,
  iat: 1,
  exp: 2,
};

const user: User = {
  id: userId,
  companyId,
  name: "Ada",
  email: "ada@example.com",
  role: "user",
  verified: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const productInput: ProductInput = {
  name: "Notebook",
  description: "Ultrabook",
  price: 4999.9,
  category: "hardware",
  imagePath: "/api/uploads/products/company-1/notebook.png",
};

const product: Product = {
  id: "product-1",
  companyId,
  ...productInput,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const message: Message = {
  role: "assistant",
  content: "Ola",
  createdAt: new Date(),
};

const conversation: Conversation = {
  id: "conversation-1",
  companyId,
  userId,
  messages: [message],
  createdAt: new Date(),
  updatedAt: new Date(),
};

const nullableProduct: Nullable<Product> = product;
const emptyProduct: Nullable<Product> = null;
const isoTimestamp = new Date().toISOString() as ISODateString;
const timestamps: Timestamped = {
  createdAt: new Date(),
  updatedAt: new Date(),
};

const companyDoc: ICompany = new Company({
  name: "Acme",
  normalizedName: "acme",
});
const userDoc: IUser = new UserModel({
  companyId: new Types.ObjectId(),
  name: "Ada",
  email: "ada@example.com",
  passwordHash: "hash",
  role: ModelUserRole.Admin,
});
const productDoc: IProduct = new ProductModel({
  companyId: new Types.ObjectId(),
  name: "Notebook",
  description: "Ultrabook",
  price: 4999.9,
  category: "hardware",
  imagePath: "/api/uploads/products/company-1/notebook.png",
});
const conversationDoc: IConversation = new ConversationModel({
  companyId: new Types.ObjectId(),
  userId: new Types.ObjectId(),
  messages: [
    {
      role: MessageRole.User,
      content: "Ola",
      createdAt: new Date(),
    },
  ],
});
const firstMessage: IMessage = conversationDoc.messages[0]!;
const companyName: string = companyDoc.name;
const modelUserRole: ModelUserRole = userDoc.role;
const companyObjectId: Types.ObjectId = userDoc.companyId;
const productTimestamp: Date = productDoc.updatedAt;
const messageTimestamp: Date = firstMessage.createdAt;
const registerInput: RegisterUserInput = {
  name: "Ada",
  email: "ada@example.com",
  password: "password123",
  companyName: "Acme",
};
const loginInput: LoginUserInput = {
  email: "ada@example.com",
  password: "password123",
};
const authResponse: AuthResponse = {
  token: "token",
  user,
};
const serializedConversation: SerializedConversation = {
  _id: "conversation-1",
  userId,
  companyId,
  messages: [
    {
      role: MessageRole.Assistant,
      content: "Ola",
      createdAt: new Date(),
    },
  ],
  createdAt: new Date(),
  updatedAt: new Date(),
};
const chatResult: ChatServiceResult = {
  conversation: serializedConversation,
  assistantMessage: {
    role: MessageRole.Assistant,
    content: "Ola",
    createdAt: new Date(),
  },
};

class ContractClient extends LLMClient {
  async createChatCompletion(_input: ChatCompletionInput): Promise<ChatCompletionResult> {
    return {
      message: {
        role: "assistant",
        content: "ok",
      },
    };
  }
}

const llmClient = new ContractClient();
const openAIProviderCtor: typeof OpenAIProvider = OpenAIProvider;
const productRepository = {} as ProductRepository;
const conversationRepository = {} as ConversationRepository;
const productSearchService = {} as ProductSearchService;
const toolExecutor = {} as ToolExecutor;
const chatService = {} as ChatService;
const toolMessage = {} as ToolMessage;
const productSearchResult = {} as ProductSearchResult;

function acceptRole(role: UserRole): UserRole {
  return role;
}

acceptRole(claims.role);
void user;
void conversation;
void nullableProduct;
void emptyProduct;
void isoTimestamp;
void timestamps;
void companyName;
void modelUserRole;
void companyObjectId;
void productTimestamp;
void messageTimestamp;
void registerInput;
void loginInput;
void authResponse;
void chatResult;
void llmClient;
void openAIProviderCtor;
void productRepository;
void conversationRepository;
void productSearchService;
void toolExecutor;
void chatService;
void toolMessage;
void productSearchResult;
