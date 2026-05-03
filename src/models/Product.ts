import { Document, Model, model, models, Schema, Types } from "mongoose";

export interface IProduct extends Document {
  companyId: Types.ObjectId;
  name: string;
  description: string;
  price: number;
  category: string;
  imageUrl?: string;
  imagePath?: string;
  createdAt: Date;
  updatedAt: Date;
}

export const productSchema = new Schema<IProduct>(
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
    description: {
      type: String,
      required: true,
      trim: true,
    },
    price: {
      type: Number,
      required: true,
      min: 0.01,
    },
    category: {
      type: String,
      required: true,
      trim: true,
    },
    imageUrl: {
      type: String,
      trim: true,
    },
    imagePath: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

productSchema.index({ companyId: 1, category: 1 });
productSchema.index({ name: "text", description: "text" });

export const Product =
  (models.Product as Model<IProduct> | undefined) || model<IProduct>("Product", productSchema);
