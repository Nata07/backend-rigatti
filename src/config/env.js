const path = require("path");

const dotenv = require("dotenv");
const { z } = require("zod");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535),
  MONGODB_URI: z
    .string()
    .min(1)
    .refine((value) => value.startsWith("mongodb://") || value.startsWith("mongodb+srv://"), {
      message: "MONGODB_URI must use mongodb:// or mongodb+srv://",
    }),
  REDIS_URL: z
    .string()
    .min(1)
    .refine((value) => value.startsWith("redis://") || value.startsWith("rediss://"), {
      message: "REDIS_URL must use redis:// or rediss://",
    }),
  CORS_ORIGIN: z.string().min(1),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters long"),
  JWT_EXPIRES_IN: z.string().min(1),
  BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(4).max(15).default(10),
  OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required"),
  OPENAI_MODEL: z.string().min(1).optional(),
  FRONTEND_URL: z.string().url().optional(),
  EMAIL_PROVIDER: z.enum(["smtp"]).default("smtp"),
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((value) => value === true || value === "true")
    .default(false),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASS: z.string().min(1).optional(),
  SMTP_FROM: z.string().email().optional(),
  EMAIL_RETRY_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(3),
  EMAIL_RETRY_DELAY_MS: z.coerce.number().int().min(0).default(250),
  RATE_LIMIT_LOGIN_WINDOW_MS: z.coerce.number().int().min(1).default(60_000),
  RATE_LIMIT_LOGIN_MAX: z.coerce.number().int().min(1).default(5),
  RATE_LIMIT_REGISTER_WINDOW_MS: z.coerce.number().int().min(1).default(60_000),
  RATE_LIMIT_REGISTER_MAX: z.coerce.number().int().min(1).default(3),
  RATE_LIMIT_FORGOT_PASSWORD_WINDOW_MS: z.coerce.number().int().min(1).default(60_000),
  RATE_LIMIT_FORGOT_PASSWORD_MAX: z.coerce.number().int().min(1).default(3),
  RATE_LIMIT_RESEND_VERIFICATION_WINDOW_MS: z.coerce.number().int().min(1).default(60_000),
  RATE_LIMIT_RESEND_VERIFICATION_MAX: z.coerce.number().int().min(1).default(3),
  RATE_LIMIT_CHAT_WINDOW_MS: z.coerce.number().int().min(1).default(60_000),
  RATE_LIMIT_CHAT_MAX: z.coerce.number().int().min(1).default(20),
  RATE_LIMIT_STREAM_MAX_CONCURRENT: z.coerce.number().int().min(1).default(10),
  RATE_LIMIT_STREAM_LEASE_MS: z.coerce.number().int().min(1).default(60_000),
});

function loadEnv(options = {}) {
  const envFilePath = options.envFilePath || path.resolve(process.cwd(), ".env");
  dotenv.config({ path: envFilePath, override: options.override ?? false });

  const parsed = envSchema.safeParse({
    NODE_ENV: process.env.NODE_ENV,
    PORT: process.env.PORT,
    MONGODB_URI: process.env.MONGODB_URI,
    REDIS_URL: process.env.REDIS_URL,
    CORS_ORIGIN: process.env.CORS_ORIGIN,
    LOG_LEVEL: process.env.LOG_LEVEL,
    JWT_SECRET: process.env.JWT_SECRET,
    JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN,
    BCRYPT_SALT_ROUNDS: process.env.BCRYPT_SALT_ROUNDS,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_MODEL: process.env.OPENAI_MODEL,
    FRONTEND_URL: process.env.FRONTEND_URL,
    EMAIL_PROVIDER: process.env.EMAIL_PROVIDER,
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_PORT: process.env.SMTP_PORT,
    SMTP_SECURE: process.env.SMTP_SECURE,
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASS: process.env.SMTP_PASS,
    SMTP_FROM: process.env.SMTP_FROM,
    EMAIL_RETRY_MAX_ATTEMPTS: process.env.EMAIL_RETRY_MAX_ATTEMPTS,
    EMAIL_RETRY_DELAY_MS: process.env.EMAIL_RETRY_DELAY_MS,
    RATE_LIMIT_LOGIN_WINDOW_MS: process.env.RATE_LIMIT_LOGIN_WINDOW_MS,
    RATE_LIMIT_LOGIN_MAX: process.env.RATE_LIMIT_LOGIN_MAX,
    RATE_LIMIT_REGISTER_WINDOW_MS: process.env.RATE_LIMIT_REGISTER_WINDOW_MS,
    RATE_LIMIT_REGISTER_MAX: process.env.RATE_LIMIT_REGISTER_MAX,
    RATE_LIMIT_FORGOT_PASSWORD_WINDOW_MS: process.env.RATE_LIMIT_FORGOT_PASSWORD_WINDOW_MS,
    RATE_LIMIT_FORGOT_PASSWORD_MAX: process.env.RATE_LIMIT_FORGOT_PASSWORD_MAX,
    RATE_LIMIT_RESEND_VERIFICATION_WINDOW_MS: process.env.RATE_LIMIT_RESEND_VERIFICATION_WINDOW_MS,
    RATE_LIMIT_RESEND_VERIFICATION_MAX: process.env.RATE_LIMIT_RESEND_VERIFICATION_MAX,
    RATE_LIMIT_CHAT_WINDOW_MS: process.env.RATE_LIMIT_CHAT_WINDOW_MS,
    RATE_LIMIT_CHAT_MAX: process.env.RATE_LIMIT_CHAT_MAX,
    RATE_LIMIT_STREAM_MAX_CONCURRENT: process.env.RATE_LIMIT_STREAM_MAX_CONCURRENT,
    RATE_LIMIT_STREAM_LEASE_MS: process.env.RATE_LIMIT_STREAM_LEASE_MS,
  });

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("; ");
    const error = new Error(`Invalid environment configuration: ${issues}`);
    error.statusCode = 500;
    throw error;
  }

  return parsed.data;
}

module.exports = {
  envSchema,
  loadEnv,
};
