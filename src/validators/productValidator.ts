import { z } from "zod";

export const PRODUCT_IMAGE_PATH_PREFIX = "/api/uploads/products/";

const productImageUrlSchema = z.string().trim().url();
const productImagePathSchema = z
  .string()
  .trim()
  .regex(
    /^\/api\/uploads\/products\/[^/]+\/[^/]+$/,
    "imagePath must match /api/uploads/products/:companyId/:filename",
  );

export const productInputSchema = z
  .object({
    name: z.string().trim().min(1),
    description: z.string().trim().min(1),
    price: z.number().positive(),
    category: z.string().trim().min(1),
    imageUrl: productImageUrlSchema.optional(),
    imagePath: productImagePathSchema.optional(),
  })
  .superRefine((value, context) => {
    if (value.imageUrl && value.imagePath) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide either imageUrl or imagePath, not both",
        path: ["imagePath"],
      });
    }
  });

export type ProductInput = z.infer<typeof productInputSchema>;

export function validateProductInput(input: unknown): ProductInput {
  return productInputSchema.parse(input);
}
