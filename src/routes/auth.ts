import express, { type Request, type Response } from "express";
import { ZodError, z } from "zod";

import type {
  AuthResponse,
  LoginUserDependencies,
  LoginUserInput,
  RegisterUserInput,
  ResendVerificationDependencies,
  VerifyEmailDependencies,
} from "../services/authService";
import type { EmailService } from "../services/emailService";
import type { HttpError } from "../types/http";
import passwordResetRouter, { type PasswordResetRouterDependencies } from "./passwordReset";

interface ErrorResponseBody {
  error: {
    message: string;
    statusCode: number;
    requestId?: string;
  };
}

type RegisterResponseBody = AuthResponse | ErrorResponseBody;
type LoginResponseBody = AuthResponse | ErrorResponseBody;
type MessageResponseBody = { message: string } | ErrorResponseBody;

export interface AuthRouterDependencies {
  registerUser?: (
    input: RegisterUserInput,
    dependencies: {
      hashPassword: NonNullable<AuthRouterDependencies["hashPassword"]>;
      signToken: NonNullable<AuthRouterDependencies["signToken"]>;
      emailService?: Pick<EmailService, "sendVerificationEmail">;
      signVerificationToken?: NonNullable<AuthRouterDependencies["signVerificationToken"]>;
      logger?: NonNullable<Express.Request["log"]>;
    },
  ) => Promise<AuthResponse>;
  loginUser?: (
    input: LoginUserInput,
    dependencies: LoginUserDependencies,
  ) => Promise<AuthResponse>;
  resendVerificationEmail?: (
    email: string,
    dependencies: ResendVerificationDependencies,
  ) => Promise<void>;
  verifyEmail?: (
    token: string,
    dependencies: VerifyEmailDependencies,
  ) => Promise<void>;
  forgotPassword?: PasswordResetRouterDependencies["forgotPassword"];
  resetPassword?: PasswordResetRouterDependencies["resetPassword"];
  hashPassword?: PasswordResetRouterDependencies["hashPassword"];
  comparePassword?: LoginUserDependencies["comparePassword"];
  signToken?: LoginUserDependencies["signToken"];
  emailService?: Pick<EmailService, "sendPasswordReset" | "sendVerificationEmail">;
  signResetToken?: PasswordResetRouterDependencies["signResetToken"];
  verifyResetToken?: PasswordResetRouterDependencies["verifyResetToken"];
  signVerificationToken?: ResendVerificationDependencies["signVerificationToken"];
  verifyVerificationToken?: VerifyEmailDependencies["verifyVerificationToken"];
  forgotPasswordRateLimiter?: PasswordResetRouterDependencies["forgotPasswordRateLimiter"];
  registerRateLimiter?: express.RequestHandler;
  loginRateLimiter?: express.RequestHandler;
  resendVerificationRateLimiter?: express.RequestHandler;
}

const registerSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().email(),
  password: z.string().min(8),
  companyName: z.string().trim().min(1),
});

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

const resendVerificationSchema = z.object({
  email: z.string().trim().email(),
});

const verifyEmailQuerySchema = z.object({
  token: z.string().trim().min(1),
});

function toHttpError(error: unknown): HttpError {
  return error as HttpError;
}

export default function authRouter(dependencies: AuthRouterDependencies = {}) {
  const router = express.Router();
  const {
    registerUser,
    loginUser,
    resendVerificationEmail,
    verifyEmail,
    hashPassword,
    comparePassword,
    signToken,
    registerRateLimiter,
    loginRateLimiter,
    resendVerificationRateLimiter,
  } = dependencies;
  const passwordResetDependencies: PasswordResetRouterDependencies = {};

  if (dependencies.forgotPassword) {
    passwordResetDependencies.forgotPassword = dependencies.forgotPassword;
  }
  if (dependencies.resetPassword) {
    passwordResetDependencies.resetPassword = dependencies.resetPassword;
  }
  if (dependencies.emailService) {
    passwordResetDependencies.emailService = dependencies.emailService;
  }
  if (dependencies.signResetToken) {
    passwordResetDependencies.signResetToken = dependencies.signResetToken;
  }
  if (dependencies.verifyResetToken) {
    passwordResetDependencies.verifyResetToken = dependencies.verifyResetToken;
  }
  if (dependencies.hashPassword) {
    passwordResetDependencies.hashPassword = dependencies.hashPassword;
  }
  if (dependencies.forgotPasswordRateLimiter) {
    passwordResetDependencies.forgotPasswordRateLimiter = dependencies.forgotPasswordRateLimiter;
  }

  router.post(
    "/register",
    ...(registerRateLimiter ? [registerRateLimiter] : []),
    (
      req: Request<unknown, RegisterResponseBody, RegisterUserInput>,
      res: Response<RegisterResponseBody>,
      next,
    ): void => {
      void (async () => {
        const input = registerSchema.parse(req.body);
        const result = await registerUser!(input, {
          hashPassword: hashPassword!,
          signToken: signToken!,
          ...(dependencies.emailService ? { emailService: dependencies.emailService } : {}),
          ...(dependencies.signVerificationToken
            ? { signVerificationToken: dependencies.signVerificationToken }
            : {}),
          ...(req.log ? { logger: req.log } : {}),
        });
        res.status(201).json(result);
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
    "/login",
    ...(loginRateLimiter ? [loginRateLimiter] : []),
    (
      req: Request<unknown, LoginResponseBody, LoginUserInput>,
      res: Response<LoginResponseBody>,
      next,
    ): void => {
      void (async () => {
        const input = loginSchema.parse(req.body);
        const result = await loginUser!(input, {
          comparePassword: comparePassword!,
          signToken: signToken!,
        });
        res.status(200).json(result);
      })().catch((error: unknown) => {
        if (error instanceof ZodError) {
          const httpError = toHttpError(error);
          httpError.statusCode = 400;
        }
        next(error);
      });
    },
  );

  router.get(
    "/verify-email",
    (
      req: Request<unknown, MessageResponseBody, unknown, { token: string }>,
      res: Response<MessageResponseBody>,
      next,
    ): void => {
      void (async () => {
        const query = verifyEmailQuerySchema.parse(req.query);
        const verifyDependencies: VerifyEmailDependencies = {
          verifyVerificationToken: dependencies.verifyVerificationToken!,
          ...(req.log ? { logger: req.log } : {}),
        };

        await verifyEmail!(query.token, verifyDependencies);

        res.status(200).json({
          message: "Email verified",
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
    "/resend-verification",
    ...(resendVerificationRateLimiter ? [resendVerificationRateLimiter] : []),
    (
      req: Request<unknown, MessageResponseBody, { email: string }>,
      res: Response<MessageResponseBody>,
      next,
    ): void => {
      void (async () => {
        const input = resendVerificationSchema.parse(req.body);
        const resendDependencies: ResendVerificationDependencies = {
          emailService: dependencies.emailService!,
          signVerificationToken: dependencies.signVerificationToken!,
          ...(req.log ? { logger: req.log } : {}),
        };

        await resendVerificationEmail!(input.email, resendDependencies);

        res.status(200).json({
          message: "Verification email sent",
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

  router.use(passwordResetRouter(passwordResetDependencies));

  return router;
}
