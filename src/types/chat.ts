import type { EntityId, Timestamped } from "./common";

export type MessageRole = "user" | "assistant";

export interface Message {
  role: MessageRole;
  content: string;
  createdAt: Date;
}

export interface Conversation extends Timestamped {
  id: EntityId;
  companyId: EntityId;
  userId: EntityId;
  messages: Message[];
}
