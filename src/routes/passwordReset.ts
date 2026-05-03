import express, { type Request, type Response } from "express";
import { ZodError, z } from "zod";

import type { EmailService } from "../services/emailService";
import type {
  ForgotPasswordDependencies,
  ResetPasswordDependencies,
} from "../services/authService";
import type { HttpError } from "../types/http";

interface ErrorResponseBody {
  error: {
    message: string;
    statusCode: number;
    requestId?: string;
  };
}

interface MessageResponseBody {
  message: string;
}

type ForgotPasswordResponseBody = MessageResponseBody | ErrorResponseBody;
type ResetPasswordResponseBody = MessageResponseBody | ErrorResponseBody;

export interface PasswordResetRouterDependencies
  extends Partial<ForgotPasswordDependencies>,
    Partial<ResetPasswordDependencies> {
  forgotPassword?: (
    email: string,
    dependencies: ForgotPasswordDependencies,
  ) => Promise<void>;
  resetPassword?: (
    token: string,
    newPassword: string,
    dependencies: ResetPasswordDependencies,
  ) => Promise<void>;
  emailService?: Pick<EmailService, "sendPasswordReset">;
  forgotPasswordRateLimiter?: express.RequestHandler;
}

const forgotPasswordSchema = z.object({
  email: z.string().trim().email(),
});

const resetPasswordSchema = z.object({
  token: z.string().trim().min(1),
  password: z.string().min(8),
});

function toHttpError(error: unknown): HttpError {
  return error as HttpError;
}

export default function passwordResetRouter(dependencies: PasswordResetRouterDependencies = {}) {
  const router = express.Router();
  const {
    forgotPassword,
    resetPassword,
    emailService,
    signResetToken,
    verifyResetToken,
    hashPassword,
    forgotPasswordRateLimiter,
  } = dependencies;

  router.post(
    "/forgot-password",
    ...(forgotPasswordRateLimiter ? [forgotPasswordRateLimiter] : []),
    (
      req: Request<unknown, ForgotPasswordResponseBody, { email: string }>,
      res: Response<ForgotPasswordResponseBody>,
      next,
    ): void => {
      void (async () => {
        const input = forgotPasswordSchema.parse(req.body);
        const forgotPasswordDependencies: ForgotPasswordDependencies = {
          emailService: emailService!,
          signResetToken: signResetToken!,
          ...(req.log ? { logger: req.log } : {}),
        };

        await forgotPassword!(input.email, forgotPasswordDependencies);

        res.status(200).json({
          message: "If account exists, reset email sent",
        });
      })().catch((error: unknown) => {
        if (error instanceof ZodError) {
          const httpError = toHttpError(error);
          httpError.statusCode = 400;
        }
        next(error);
      });
    },
  );

  router.post(
    "/reset-password",
    (
      req: Request<unknown, ResetPasswordResponseBody, { token: string; password: string }>,
      res: Response<ResetPasswordResponseBody>,
      next,
    ): void => {
      void (async () => {
        const input = resetPasswordSchema.parse(req.body);
        const resetPasswordDependencies: ResetPasswordDependencies = {
          hashPassword: hashPassword!,
          verifyResetToken: verifyResetToken!,
          ...(req.log ? { logger: req.log } : {}),
        };

        await resetPassword!(input.token, input.password, resetPasswordDependencies);

        res.status(200).json({
          message: "Password reset successful",
        });
      })().catch((error: unknown) => {
        if (error instanceof ZodError) {
          const httpError = toHttpError(error);
          httpError.statusCode = 400;
        }
        next(error);
      });
    },
  );

  return router;
}
