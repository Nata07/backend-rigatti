const path = require("path");

const { loadEnv } = require("../../src/config/env");

describe("loadEnv", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.NODE_ENV;
    delete process.env.PORT;
    delete process.env.MONGODB_URI;
    delete process.env.REDIS_URL;
    delete process.env.CORS_ORIGIN;
    delete process.env.LOG_LEVEL;
    delete process.env.JWT_SECRET;
    delete process.env.JWT_EXPIRES_IN;
    delete process.env.BCRYPT_SALT_ROUNDS;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_MODEL;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("rejects incomplete environment configuration", () => {
    expect(() =>
      loadEnv({
        envFilePath: path.resolve(__dirname, "../fixtures/missing.env"),
        override: true,
      })
    ).toThrow(/Invalid environment configuration/);
  });

  it("accepts a valid environment configuration", () => {
    const env = loadEnv({
      envFilePath: path.resolve(__dirname, "../fixtures/valid.env"),
      override: true,
    });

    expect(env).toMatchObject({
      NODE_ENV: "test",
      PORT: 4010,
      MONGODB_URI: "mongodb://mongodb.example.test:27017/mini-saas-test",
      REDIS_URL: "redis://redis.example.test:6379",
      CORS_ORIGIN: "http://localhost:3000",
      LOG_LEVEL: "silent",
      JWT_SECRET: "super-secret-key-for-tests-with-32-chars",
      JWT_EXPIRES_IN: "1h",
      BCRYPT_SALT_ROUNDS: 10,
      OPENAI_API_KEY: "test-openai-key",
      FRONTEND_URL: "http://localhost:3000",
      EMAIL_PROVIDER: "smtp",
      SMTP_HOST: "smtp.example.test",
      SMTP_PORT: 587,
      SMTP_SECURE: false,
      SMTP_USER: "smtp-user",
      SMTP_PASS: "smtp-pass",
      SMTP_FROM: "no-reply@example.test",
      EMAIL_RETRY_MAX_ATTEMPTS: 4,
      EMAIL_RETRY_DELAY_MS: 500,
      RATE_LIMIT_FORGOT_PASSWORD_WINDOW_MS: 60000,
      RATE_LIMIT_FORGOT_PASSWORD_MAX: 3,
      RATE_LIMIT_RESEND_VERIFICATION_WINDOW_MS: 60000,
      RATE_LIMIT_RESEND_VERIFICATION_MAX: 3,
    });
  });

  it("accepts an optional OpenAI model override", () => {
    process.env.OPENAI_MODEL = "gpt-4.1-mini";

    const env = loadEnv({
      envFilePath: path.resolve(__dirname, "../fixtures/valid.env"),
      override: true,
    });

    expect(env.OPENAI_MODEL).toBe("gpt-4.1-mini");
  });
});
