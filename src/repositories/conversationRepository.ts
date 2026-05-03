import { Conversation, type IConversation, type IMessage } from "../models";

export interface ConversationUpdateInput {
  userId: string;
  companyId: string;
  messages: IMessage[];
}

export interface ConversationCreateInput {
  userId: string;
  companyId: string;
  messages?: IMessage[];
}

export interface ConversationRepository {
  findByUserId(userId: string, companyId: string): Promise<IConversation | null>;
  create(input: ConversationCreateInput): Promise<IConversation>;
  update(id: string, input: ConversationUpdateInput): Promise<IConversation | null>;
}

export function createConversationRepository({
  ConversationModel = Conversation,
}: {
  ConversationModel?: typeof Conversation;
} = {}): ConversationRepository {
  return {
    async findByUserId(userId: string, companyId: string): Promise<IConversation | null> {
      return ConversationModel.findOne({ userId, companyId });
    },

    async create({ userId, companyId, messages = [] }: ConversationCreateInput): Promise<IConversation> {
      return ConversationModel.create({
        userId,
        companyId,
        messages,
      });
    },

    async update(id: string, { userId, companyId, messages }: ConversationUpdateInput): Promise<IConversation | null> {
      return ConversationModel.findOneAndUpdate(
        { _id: id, userId, companyId },
        { messages, companyId, userId },
        { new: true, runValidators: true },
      );
    },
  };
}
