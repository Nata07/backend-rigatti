import { Document, Model, model, models, Schema, Types } from "mongoose";

export enum UserRole {
  Admin = "admin",
  User = "user",
}

export interface IUser extends Document {
  companyId: Types.ObjectId;
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  verified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export const userSchema = new Schema<IUser>(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      required: true,
      enum: Object.values(UserRole),
    },
    verified: {
      type: Boolean,
      required: true,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

export const User =
  (models.User as Model<IUser> | undefined) || model<IUser>("User", userSchema);
