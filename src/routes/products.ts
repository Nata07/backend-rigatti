import express, { type NextFunction, type Request, type Response } from "express";

import type { ProductService } from "../services/productService";
import type { IProduct } from "../models";

interface ErrorResponseBody {
  error: {
    message: string;
    statusCode: number;
    requestId?: string | undefined;
  };
}

type ProductResponse = IProduct | ErrorResponseBody;
type ProductListResponse = IProduct[] | ErrorResponseBody;

type Middleware = (req: Request, res: Response, next: NextFunction) => void;

export interface ProductsRouterDependencies {
  authenticate: Middleware;
  requireAdmin: Middleware;
  requireVerified?: Middleware;
  productService: ProductService;
}

export default function createProductsRouter({
  authenticate,
  requireAdmin,
  requireVerified,
  productService,
}: ProductsRouterDependencies) {
  const router = express.Router();

  router.use(authenticate);

  router.get(
    "/",
    (req: Request, res: Response<ProductListResponse>, next: NextFunction): void => {
      void (async () => {
        const products = await productService.listProducts(req.auth!);
        res.status(200).json(products);
      })().catch((error: unknown) => {
        next(error);
      });
    },
  );

  router.post(
    "/",
    ...(requireVerified ? [requireVerified] : []),
    requireAdmin,
    (req: Request, res: Response<ProductResponse>, next: NextFunction): void => {
      void (async () => {
        const product = await productService.createProduct(req.body, req.auth!);
        res.status(201).json(product);
      })().catch((error: unknown) => {
        next(error);
      });
    },
  );

  router.put(
    "/:id",
    ...(requireVerified ? [requireVerified] : []),
    requireAdmin,
    (
      req: Request<{ id: string }>,
      res: Response<ProductResponse>,
      next: NextFunction,
    ): void => {
      void (async () => {
        const product = await productService.updateProduct(req.params.id, req.body, req.auth!);
        res.status(200).json(product);
      })().catch((error: unknown) => {
        next(error);
      });
    },
  );

  router.delete(
    "/:id",
    ...(requireVerified ? [requireVerified] : []),
    requireAdmin,
    (
      req: Request<{ id: string }>,
      res: Response<void | ErrorResponseBody>,
      next: NextFunction,
    ): void => {
      void (async () => {
        await productService.deleteProduct(req.params.id, req.auth!);
        res.status(204).send();
      })().catch((error: unknown) => {
        next(error);
      });
    },
  );

  return router;
}
