import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";

import type { HttpError } from "../types/http";

type Middleware = (req: Request, res: Response, next: NextFunction) => void;
type FileFilterCallback = (error: Error | null, acceptFile?: boolean) => void;

interface UploadResponseBody {
  imagePath: string;
  filename: string;
  size: number;
}

export interface UploadsRouterDependencies {
  authenticate: Middleware;
  requireAdmin: Middleware;
  requireVerified?: Middleware;
}

export const PRODUCT_IMAGE_UPLOAD_FIELD = "image";
export const PRODUCT_IMAGE_MAX_SIZE_BYTES = 5 * 1024 * 1024;
export const PRODUCT_IMAGE_ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

function createHttpError(statusCode: number, message: string): HttpError {
  const error = new Error(message) as HttpError;
  error.statusCode = statusCode;
  return error;
}

export function getProductUploadsRoot(): string {
  return path.resolve(__dirname, "../../uploads/products");
}

export function resolveProductImageDirectory(
  companyId: string,
  {
    uploadsRoot = getProductUploadsRoot(),
    mkdirSync = fs.mkdirSync,
  }: {
    uploadsRoot?: string;
    mkdirSync?: typeof fs.mkdirSync;
  } = {},
): string {
  const directory = path.join(uploadsRoot, companyId);
  mkdirSync(directory, { recursive: true });
  return directory;
}

export function buildProductImageFilename(
  originalname: string,
  createId: () => string = randomUUID,
): string {
  const extension = path.extname(originalname).toLowerCase();
  return `${createId()}${extension}`;
}

export function productImageFileFilter(
  _req: Request,
  file: Express.Multer.File,
  callback: FileFilterCallback,
): void {
  if (PRODUCT_IMAGE_ALLOWED_MIME_TYPES.includes(file.mimetype as (typeof PRODUCT_IMAGE_ALLOWED_MIME_TYPES)[number])) {
    callback(null, true);
    return;
  }

  callback(createHttpError(400, "Invalid file type"));
}

export function buildProductImagePath(companyId: string, filename: string): string {
  return `/api/uploads/products/${companyId}/${filename}`;
}

function createProductImageUpload() {
  const storage = multer.diskStorage({
    destination(req, _file, callback) {
      callback(null, resolveProductImageDirectory(req.auth!.companyId));
    },
    filename(_req, file, callback) {
      callback(null, buildProductImageFilename(file.originalname));
    },
  });

  return multer({
    storage,
    limits: {
      fileSize: PRODUCT_IMAGE_MAX_SIZE_BYTES,
    },
    fileFilter: productImageFileFilter,
  });
}

function mapUploadError(error: unknown): HttpError {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    return createHttpError(400, "File too large");
  }

  if (error && typeof error === "object" && "statusCode" in error && typeof error.statusCode === "number") {
    return error as HttpError;
  }

  return createHttpError(400, "Upload failed");
}

function isSafePathSegment(value: string): boolean {
  return value.length > 0 && value === path.basename(value) && !value.includes("\0");
}

export default function createUploadsRouter({
  authenticate,
  requireAdmin,
  requireVerified,
}: UploadsRouterDependencies) {
  const router = express.Router();
  const upload = createProductImageUpload();

  router.use(authenticate);

  router.post(
    "/product-image",
    ...(requireVerified ? [requireVerified] : []),
    requireAdmin,
    (req: Request, res: Response<UploadResponseBody>, next: NextFunction): void => {
      upload.single(PRODUCT_IMAGE_UPLOAD_FIELD)(req, res, (error: unknown) => {
        if (error) {
          next(mapUploadError(error));
          return;
        }

        if (!req.file) {
          next(createHttpError(400, "No file uploaded"));
          return;
        }

        res.status(200).json({
          imagePath: buildProductImagePath(req.auth!.companyId, req.file.filename),
          filename: req.file.filename,
          size: req.file.size,
        });
      });
    },
  );

  router.get(
    "/products/:companyId/:filename",
    (
      req: Request<{ companyId: string; filename: string }>,
      res: Response,
      next: NextFunction,
    ): void => {
      if (req.auth!.companyId !== req.params.companyId) {
        next(createHttpError(404, "Image not found"));
        return;
      }

      if (!isSafePathSegment(req.params.filename) || !isSafePathSegment(req.params.companyId)) {
        next(createHttpError(404, "Image not found"));
        return;
      }

      const absolutePath = path.join(getProductUploadsRoot(), req.params.companyId, req.params.filename);
      res.sendFile(absolutePath, (error) => {
        if (!error) {
          return;
        }

        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          next(createHttpError(404, "Image not found"));
          return;
        }

        next(error);
      });
    },
  );

  return router;
}
