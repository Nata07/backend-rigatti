import { ZodError, z } from "zod";

import { createProductRepository, type ProductRepository, type SearchByCompanyInput } from "../repositories/productRepository";

interface HttpError extends Error {
  statusCode: number;
}

interface ObjectIdLike {
  toString(): string;
}

interface ProductSearchDocument {
  _id: ObjectIdLike | string;
  name: string;
  description: string;
  price: number;
  category: string;
  imageUrl?: string;
}

export interface ProductSearchInput {
  companyId: string;
  query?: string | undefined;
  category?: string | undefined;
  limit?: number | undefined;
}

export interface ValidatedProductSearchInput extends SearchByCompanyInput {
  companyId: string;
  query?: string | undefined;
  category?: string | undefined;
}

export interface ProductSearchResult {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  imageUrl?: string;
}

export interface ProductSearchService {
  searchForCompany(input: ProductSearchInput): Promise<ProductSearchResult[]>;
  validateSearchArguments(input: unknown): ValidatedProductSearchInput;
}

const productSearchSchema = z.object({
  companyId: z.string().trim().min(1, "companyId is required"),
  query: z.string().trim().default(""),
  category: z.string().trim().min(1, "category cannot be empty").optional(),
  limit: z.coerce.number().int().min(1, "limit must be at least 1").max(20, "limit must be at most 20").default(5),
});

function createHttpError(statusCode: number, message: string): HttpError {
  const error = new Error(message) as HttpError;
  error.statusCode = statusCode;
  return error;
}

function toEntityId(value: ObjectIdLike | string): string {
  return typeof value === "string" ? value : value.toString();
}

export function createProductSearchService({
  productRepository = createProductRepository(),
}: {
  productRepository?: ProductRepository;
} = {}): ProductSearchService {
  async function searchForCompany(input: ProductSearchInput): Promise<ProductSearchResult[]> {
    const validatedInput = validateSearchArguments(input);
    const products = await productRepository.searchByCompany(validatedInput);

    return products.map((product) => serializeProductSearchResult(product as unknown as ProductSearchDocument));
  }

  return {
    searchForCompany,
    validateSearchArguments,
  };
}

export function validateSearchArguments(input: unknown): ValidatedProductSearchInput {
  try {
    return productSearchSchema.parse(input);
  } catch (error) {
    if (error instanceof ZodError) {
      throw createHttpError(400, error.issues[0]?.message ?? "Invalid product search input");
    }

    throw error;
  }
}

function serializeProductSearchResult(product: ProductSearchDocument): ProductSearchResult {
  return {
    id: toEntityId(product._id),
    name: product.name,
    description: product.description,
    price: product.price,
    category: product.category,
    ...(product.imageUrl ? { imageUrl: product.imageUrl } : {}),
  };
}
