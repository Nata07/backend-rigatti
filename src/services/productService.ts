import fs from "fs/promises";
import path from "path";
import { isValidObjectId } from "mongoose";
import { createProductRepository, type ProductRepository } from "../repositories/productRepository";
import type { AuthContext } from "../types/auth";
import type { ProductInput } from "../types/product";
import { validateProductInput } from "../validators/productValidator";
import type { IProduct } from "../models";

interface HttpError extends Error {
  statusCode: number;
}

export interface ProductService {
  listProducts(authContext: Pick<AuthContext, "companyId">): Promise<IProduct[]>;
  createProduct(input: unknown, authContext: Pick<AuthContext, "companyId">): Promise<IProduct>;
  updateProduct(id: string, input: unknown, authContext: Pick<AuthContext, "companyId">): Promise<IProduct>;
  deleteProduct(id: string, authContext: Pick<AuthContext, "companyId">): Promise<void>;
  getProductById(id: string, authContext: Pick<AuthContext, "companyId">): Promise<IProduct | null>;
}

export interface ProductServiceDependencies {
  productRepository?: ProductRepository;
  validateInput?: (input: unknown) => ProductInput;
  deleteImageFile?: (imagePath: string, companyId: string) => Promise<void>;
}

function createHttpError(statusCode: number, message: string): HttpError {
  const error = new Error(message) as HttpError;
  error.statusCode = statusCode;
  return error;
}

function isZodErrorLike(error: unknown): error is { issues?: Array<{ message?: string }>; name?: string } {
  return Boolean(error && typeof error === "object" && (error as { name?: string }).name === "ZodError");
}

export function createProductService({
  productRepository = createProductRepository(),
  validateInput = validateProductInput as (input: unknown) => ProductInput,
  deleteImageFile = deleteProductImageFile,
}: ProductServiceDependencies = {}): ProductService {
  async function listProducts({ companyId }: Pick<AuthContext, "companyId">): Promise<IProduct[]> {
    return productRepository.findByCompany(companyId);
  }

  async function createProduct(input: unknown, { companyId }: Pick<AuthContext, "companyId">): Promise<IProduct> {
    const productData = parseProductInput(input, validateInput);
    return productRepository.create(productData, companyId);
  }

  async function updateProduct(
    id: string,
    input: unknown,
    { companyId }: Pick<AuthContext, "companyId">,
  ): Promise<IProduct> {
    ensureValidProductId(id);

    const productData = parseProductInput(input, validateInput);
    const product = await productRepository.update(id, companyId, productData);

    if (!product) {
      throw createHttpError(404, "Product not found");
    }

    return product;
  }

  async function deleteProduct(id: string, { companyId }: Pick<AuthContext, "companyId">): Promise<void> {
    ensureValidProductId(id);

    const product = await productRepository.delete(id, companyId);

    if (!product) {
      throw createHttpError(404, "Product not found");
    }

    const imagePath = (product as IProduct & { imagePath?: string }).imagePath;
    if (typeof imagePath === "string" && imagePath.trim()) {
      await deleteImageFile(imagePath, companyId);
    }
  }

  async function getProductById(
    id: string,
    { companyId }: Pick<AuthContext, "companyId">,
  ): Promise<IProduct | null> {
    ensureValidProductId(id);
    return productRepository.findByIdAndCompany(id, companyId);
  }

  return {
    createProduct,
    deleteProduct,
    getProductById,
    listProducts,
    updateProduct,
  };
}

async function deleteProductImageFile(imagePath: string, companyId: string): Promise<void> {
  const expectedPrefix = `/api/uploads/products/${companyId}/`;

  if (!imagePath.startsWith(expectedPrefix)) {
    return;
  }

  const filename = imagePath.slice(expectedPrefix.length);
  if (!filename || filename !== path.basename(filename) || filename.includes("\0")) {
    return;
  }

  const absolutePath = path.resolve(__dirname, "../../uploads/products", companyId, filename);

  try {
    await fs.unlink(absolutePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      throw error;
    }
  }
}

function parseProductInput(
  input: unknown,
  validateInput: (input: unknown) => ProductInput,
): ProductInput {
  try {
    return validateInput(input);
  } catch (error) {
    if (isZodErrorLike(error)) {
      throw createHttpError(400, error.issues?.[0]?.message ?? "Invalid product input");
    }

    throw error;
  }
}

function ensureValidProductId(id: string): void {
  if (!isValidObjectId(id)) {
    throw createHttpError(404, "Product not found");
  }
}
