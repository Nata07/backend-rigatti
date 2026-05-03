import { Document, Model, model, models, Schema, Types } from "mongoose";

export enum MessageRole {
  User = "user",
  Assistant = "assistant",
}

export interface IMessage {
  role: MessageRole;
  content: string;
  createdAt: Date;
}

export interface IConversation extends Document {
  companyId: Types.ObjectId;
  userId: Types.ObjectId;
  messages: IMessage[];
  createdAt: Date;
  updatedAt: Date;
}

export const messageSchema = new Schema<IMessage>(
  {
    role: {
      type: String,
      required: true,
      enum: Object.values(MessageRole),
    },
    content: {
      type: String,
      required: true,
      trim: true,
    },
    createdAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  {
    _id: false,
  }
);

export const conversationSchema = new Schema<IConversation>(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    messages: {
      type: [messageSchema],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

export const Conversation =
  (models.Conversation as Model<IConversation> | undefined) ||
  model<IConversation>("Conversation", conversationSchema);
