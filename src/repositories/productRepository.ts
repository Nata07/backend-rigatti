import { Product, type IProduct } from "../models";
import type { ProductInput } from "../types/product";

export interface SearchByCompanyInput {
  companyId: string;
  query?: string | undefined;
  category?: string | undefined;
  limit: number;
}

export interface ProductRepository {
  findByCompany(companyId: string): Promise<IProduct[]>;
  findByIdAndCompany(id: string, companyId: string): Promise<IProduct | null>;
  create(productData: ProductInput, companyId: string): Promise<IProduct>;
  searchByCompany(input: SearchByCompanyInput): Promise<IProduct[]>;
  update(id: string, companyId: string, productData: ProductInput): Promise<IProduct | null>;
  delete(id: string, companyId: string): Promise<IProduct | null>;
}

function buildProductUpdatePayload(productData: ProductInput, companyId: string) {
  const setPayload: Record<string, unknown> = {
    ...productData,
    companyId,
  };
  const unsetPayload: Record<string, 1> = {};

  if (productData.imagePath) {
    unsetPayload.imageUrl = 1;
  }

  if (productData.imageUrl) {
    unsetPayload.imagePath = 1;
  }

  if (Object.keys(unsetPayload).length === 0) {
    return setPayload;
  }

  return {
    $set: setPayload,
    $unset: unsetPayload,
  };
}

export function createProductRepository({
  ProductModel = Product,
}: {
  ProductModel?: typeof Product;
} = {}): ProductRepository {
  return {
    async findByCompany(companyId: string): Promise<IProduct[]> {
      return ProductModel.find({ companyId }).sort({ createdAt: -1 });
    },

    async findByIdAndCompany(id: string, companyId: string): Promise<IProduct | null> {
      return ProductModel.findOne({ _id: id, companyId });
    },

    async create(productData: ProductInput, companyId: string): Promise<IProduct> {
      return ProductModel.create({
        ...productData,
        companyId,
      });
    },

    async searchByCompany({ companyId, query, category, limit }: SearchByCompanyInput): Promise<IProduct[]> {
      const filters: { companyId: string; category?: string } = { companyId };

      if (category) {
        filters.category = category;
      }

      const normalizedQuery = typeof query === "string" ? query.trim() : "";
      const mongooseQuery = normalizedQuery
        ? ProductModel.find({
            ...filters,
            $text: { $search: normalizedQuery },
          })
            .select({ score: { $meta: "textScore" } })
            .sort({ score: { $meta: "textScore" } })
        : ProductModel.find(filters).sort({ createdAt: -1 });

      return mongooseQuery.limit(limit);
    },

    async update(id: string, companyId: string, productData: ProductInput): Promise<IProduct | null> {
      return ProductModel.findOneAndUpdate(
        { _id: id, companyId },
        buildProductUpdatePayload(productData, companyId),
        {
          new: true,
          runValidators: true,
        },
      );
    },

    async delete(id: string, companyId: string): Promise<IProduct | null> {
      return ProductModel.findOneAndDelete({ _id: id, companyId });
    },
  };
}
