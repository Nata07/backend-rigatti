import http from "http";

import { createApp } from "./app";
import { loadEnv } from "./config/env";
import { createLLMClient } from "./config/llm";
import { connectToDatabase, disconnectFromDatabase, getDatabaseStatus } from "./config/database";
import { createRedisClient } from "./config/redis";
import { createAuthenticate } from "./middleware/authenticate";
import { createRequireVerified } from "./middleware/requireVerified";
import { createLogger } from "./middleware/requestLogger";
import { createRateLimiters } from "./middleware/rateLimiter";
import { requireAdmin } from "./middleware/requireAdmin";
import { createConversationRepository } from "./repositories/conversationRepository";
import { createProductRepository } from "./repositories/productRepository";
import createChatRouter from "./routes/chat";
import createChatStreamRouter from "./routes/chatStream";
import createProductsRouter from "./routes/products";
import createUploadsRouter from "./routes/uploads";
import { forgotPassword, loginUser, registerUser, resendVerificationEmail, resetPassword, verifyEmail } from "./services/authService";
import { createChatService } from "./services/chatService";
import { createSmtpEmailProvider, EmailService } from "./services/emailService";
import { createProductSearchService } from "./services/productSearchService";
import { createProductService } from "./services/productService";
import { createToolExecutor } from "./services/toolExecutor";
import { createJwtSigner, createJwtVerifier } from "./utils/jwt";
import { createPasswordHasher, createPasswordVerifier } from "./utils/password";

function createEmailServiceFromEnv(env: ReturnType<typeof loadEnv>, logger: ReturnType<typeof createLogger>) {
  if (!env.FRONTEND_URL || !env.SMTP_HOST || !env.SMTP_FROM) {
    const error = new Error(
      "Invalid environment configuration: FRONTEND_URL, SMTP_HOST, and SMTP_FROM are required for email delivery",
    ) as Error & { statusCode?: number };
    error.statusCode = 500;
    throw error;
  }

  const providerOptions = {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    from: env.SMTP_FROM,
    ...(env.SMTP_USER ? { user: env.SMTP_USER } : {}),
    ...(env.SMTP_PASS ? { pass: env.SMTP_PASS } : {}),
  };

  const provider = createSmtpEmailProvider(providerOptions);

  return new EmailService({
    provider,
    logger,
    frontendUrl: env.FRONTEND_URL,
    defaultFrom: env.SMTP_FROM,
    retryPolicy: {
      maxAttempts: env.EMAIL_RETRY_MAX_ATTEMPTS,
      delayMs: env.EMAIL_RETRY_DELAY_MS,
    },
  });
}

export async function startServer() {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL);
  const redis = createRedisClient({
    url: env.REDIS_URL,
    logger,
  });
  const authConfig = {
    registerUser,
    loginUser,
    forgotPassword,
    resetPassword,
    hashPassword: createPasswordHasher(env.BCRYPT_SALT_ROUNDS),
    comparePassword: createPasswordVerifier(),
    signToken: createJwtSigner({
      secret: env.JWT_SECRET,
      expiresIn: env.JWT_EXPIRES_IN,
    }),
    signResetToken: createJwtSigner({
      secret: env.JWT_SECRET,
      expiresIn: "15m",
    }),
    signVerificationToken: createJwtSigner({
      secret: env.JWT_SECRET,
      expiresIn: "24h",
    }),
    verifyToken: createJwtVerifier({
      secret: env.JWT_SECRET,
    }),
    verifyResetToken: createJwtVerifier({
      secret: env.JWT_SECRET,
    }),
    verifyVerificationToken: createJwtVerifier({
      secret: env.JWT_SECRET,
    }),
    emailService: createEmailServiceFromEnv(env, logger),
  };
  const authenticate = createAuthenticate({
    verifyToken: authConfig.verifyToken,
  });
  const requireVerified = createRequireVerified();
  const productService = createProductService({
    productRepository: createProductRepository(),
  });
  const productSearchService = createProductSearchService({
    productRepository: createProductRepository(),
  });
  const chatService = createChatService({
    conversationRepository: createConversationRepository(),
    llmClient: createLLMClient({
      apiKey: env.OPENAI_API_KEY,
      model: env.OPENAI_MODEL,
    }),
    toolExecutor: createToolExecutor({
      productSearchService,
    }),
  });

  await connectToDatabase(env.MONGODB_URI);
  await redis.connect();

  const rateLimiters = createRateLimiters(
    {
      redis,
      logger,
    },
    {
      loginWindowMs: env.RATE_LIMIT_LOGIN_WINDOW_MS,
      loginMax: env.RATE_LIMIT_LOGIN_MAX,
      registerWindowMs: env.RATE_LIMIT_REGISTER_WINDOW_MS,
      registerMax: env.RATE_LIMIT_REGISTER_MAX,
      forgotPasswordWindowMs: env.RATE_LIMIT_FORGOT_PASSWORD_WINDOW_MS,
      forgotPasswordMax: env.RATE_LIMIT_FORGOT_PASSWORD_MAX,
      resendVerificationWindowMs: env.RATE_LIMIT_RESEND_VERIFICATION_WINDOW_MS,
      resendVerificationMax: env.RATE_LIMIT_RESEND_VERIFICATION_MAX,
      chatWindowMs: env.RATE_LIMIT_CHAT_WINDOW_MS,
      chatMax: env.RATE_LIMIT_CHAT_MAX,
      streamMax: env.RATE_LIMIT_STREAM_MAX_CONCURRENT,
      streamLeaseMs: env.RATE_LIMIT_STREAM_LEASE_MS,
    },
  );

  const authRouterConfig = {
    ...authConfig,
    resendVerificationEmail,
    verifyEmail,
    registerRateLimiter: rateLimiters.registerRateLimiter,
    loginRateLimiter: rateLimiters.loginRateLimiter,
    forgotPasswordRateLimiter: rateLimiters.forgotPasswordRateLimiter,
    resendVerificationRateLimiter: rateLimiters.resendVerificationRateLimiter,
  };

  const app = createApp({
    logger,
    corsOrigin: env.CORS_ORIGIN,
    authConfig: authRouterConfig,
    getHealthStatus: () => ({
      status:
        getDatabaseStatus() === "connected" && redis.getStatus().status === "connected" ? "ok" : "degraded",
      database: getDatabaseStatus(),
      redis: redis.getStatus().status,
      redisFallbackEnabled: redis.getStatus().fallbackEnabled,
    }),
    registerRoutes(registeredApp) {
      registeredApp.use(
        "/api/products",
        createProductsRouter({
          authenticate,
          requireAdmin,
          requireVerified,
          productService,
        }),
      );
      registeredApp.use(
        "/api/chat",
        createChatRouter({
          authenticate,
          requireVerified,
          chatService,
          chatRateLimiter: rateLimiters.chatRateLimiter,
        }),
      );
      registeredApp.use(
        "/api/chat/stream",
        createChatStreamRouter({
          authenticate,
          requireVerified,
          chatService,
          logger,
          streamRateLimiter: rateLimiters.streamRateLimiter,
        }),
      );
      registeredApp.use(
        "/api/uploads",
        createUploadsRouter({
          authenticate,
          requireAdmin,
          requireVerified,
        }),
      );
    },
  });

  const server = http.createServer(app);

  await new Promise<void>((resolve) => {
    server.listen(env.PORT, () => {
      logger.info({ port: env.PORT }, "Server listening");
      resolve();
    });
  });

  async function shutdown(signal: string) {
    logger.info({ signal }, "Shutting down server");

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });

    await Promise.all([disconnectFromDatabase(), redis.disconnect()]);
  }

  const handleSignal = (signal: string) => {
    shutdown(signal)
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        logger.error({ err: error, signal }, "Graceful shutdown failed");
        process.exit(1);
      });
  };

  process.once("SIGINT", () => handleSignal("SIGINT"));
  process.once("SIGTERM", () => handleSignal("SIGTERM"));

  return {
    app,
    env,
    logger,
    redis,
    server,
    shutdown,
  };
}

if (require.main === module) {
  startServer().catch((error: unknown) => {
    console.error("Failed to start server", error);
    process.exit(1);
  });
}
