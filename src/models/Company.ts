import {
  CallbackWithoutResultAndOptionalError,
  Document,
  Model,
  model,
  models,
  Schema,
} from "mongoose";

export interface ICompany extends Document {
  name: string;
  normalizedName: string;
  createdAt: Date;
  updatedAt: Date;
}

export const companySchema = new Schema<ICompany>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    normalizedName: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

companySchema.pre("validate", function setNormalizedName(next: CallbackWithoutResultAndOptionalError) {
  if (this.name) {
    this.normalizedName = this.name.trim().toLowerCase();
  }

  next();
});

export const Company =
  (models.Company as Model<ICompany> | undefined) || model<ICompany>("Company", companySchema);
