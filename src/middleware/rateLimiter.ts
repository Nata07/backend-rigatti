import type { NextFunction, Request, RequestHandler, Response } from "express";
import { MemoryStore, ipKeyGenerator, rateLimit, type Store } from "express-rate-limit";

import type { AuthContext } from "../types/auth";
import type { RedisCommandReply, TypedRedisClient } from "../types/redis";

interface ErrorResponseBody {
  error: {
    message: string;
    statusCode: number;
    requestId?: string | undefined;
  };
}

interface RateLimitLogger {
  warn(context: Record<string, unknown>, message: string): void;
}

type KeyGenerator = (req: Request) => string;

export interface FixedWindowRateLimiterOptions {
  windowMs: number;
  max: number;
  message: string;
  prefix: string;
  keyGenerator: KeyGenerator;
}

export interface ConcurrentRateLimiterOptions {
  max: number;
  message: string;
  prefix: string;
  leaseMs?: number;
  keyGenerator: KeyGenerator;
}

export interface RateLimiterDependencies {
  redis: TypedRedisClient;
  logger: RateLimitLogger;
}

export interface RateLimiterSet {
  loginRateLimiter: RequestHandler;
  registerRateLimiter: RequestHandler;
  forgotPasswordRateLimiter: RequestHandler;
  resendVerificationRateLimiter: RequestHandler;
  chatRateLimiter: RequestHandler;
  streamRateLimiter: RequestHandler;
}

const DEFAULT_STREAM_LEASE_MS = 60_000;

class RedisFixedWindowStore implements Store {
  readonly localKeys = false;

  readonly prefix: string;

  private readonly fallbackStore = new MemoryStore();

  private windowMs = 60_000;

  constructor(
    private readonly redis: TypedRedisClient,
    prefix: string,
  ) {
    this.prefix = prefix;
  }

  init(options: { windowMs: number }): void {
    this.windowMs = options.windowMs;
    this.fallbackStore.init({
      windowMs: options.windowMs,
    } as never);
  }

  async get(key: string) {
    return this.redis.runWithFallback(
      "rate-limit:get",
      async () => {
        const redisKey = this.prefixKey(key);
        const totalHitsReply = await this.redis.command("GET", redisKey);

        if (totalHitsReply === null || typeof totalHitsReply === "boolean") {
          return undefined;
        }

        const ttlReply = await this.redis.command("PTTL", redisKey);
        const ttlMs = Math.max(toNumber(ttlReply, "PTTL"), 0);

        return {
          totalHits: toNumber(totalHitsReply, "GET"),
          resetTime: new Date(Date.now() + ttlMs),
        };
      },
      () => this.fallbackStore.get(key),
    );
  }

  async increment(key: string) {
    return this.redis.runWithFallback(
      "rate-limit:increment",
      async () => {
        const redisKey = this.prefixKey(key);
        const totalHits = toNumber(await this.redis.command("INCR", redisKey), "INCR");
        let ttlMs = toNumber(await this.redis.command("PTTL", redisKey), "PTTL");

        if (ttlMs < 0) {
          await this.redis.command("PEXPIRE", redisKey, String(this.windowMs));
          ttlMs = this.windowMs;
        }

        return {
          totalHits,
          resetTime: new Date(Date.now() + ttlMs),
        };
      },
      () => this.fallbackStore.increment(key),
    );
  }

  async decrement(key: string) {
    await this.redis.runWithFallback(
      "rate-limit:decrement",
      async () => {
        const redisKey = this.prefixKey(key);
        const totalHits = toNumber(await this.redis.command("DECR", redisKey), "DECR");

        if (totalHits <= 0) {
          await this.redis.command("DEL", redisKey);
        }
      },
      async () => {
        await this.fallbackStore.decrement(key);
      },
    );
  }

  async resetKey(key: string) {
    await this.redis.runWithFallback(
      "rate-limit:reset-key",
      async () => {
        await this.redis.command("DEL", this.prefixKey(key));
      },
      async () => {
        await this.fallbackStore.resetKey(key);
      },
    );
  }

  private prefixKey(key: string): string {
    return `${this.prefix}${key}`;
  }
}

export function keyByIp(req: Request): string {
  return `ip:${ipKeyGenerator(req.ip ?? "")}`;
}

export function keyByUser(req: Request): string {
  return authKey(req.auth) ?? keyByIp(req);
}

export function createRateLimiter(
  { redis, logger }: RateLimiterDependencies,
  options: FixedWindowRateLimiterOptions,
): RequestHandler {
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.max,
    message: options.message,
    legacyHeaders: true,
    standardHeaders: false,
    passOnStoreError: true,
    keyGenerator: (req) => options.keyGenerator(req),
    skip: (req) => req.auth?.role === "admin",
    store: new RedisFixedWindowStore(redis, options.prefix),
    handler: (req, res) => {
      logViolation(logger, req, options.max, options.keyGenerator(req), "fixed-window");
      respondTooManyRequests(req, res, options.message);
    },
  });
}

export function createConcurrentRateLimiter(
  { redis, logger }: RateLimiterDependencies,
  options: ConcurrentRateLimiterOptions,
): RequestHandler {
  const leaseMs = options.leaseMs ?? DEFAULT_STREAM_LEASE_MS;

  return (req: Request, res: Response<ErrorResponseBody>, next: NextFunction) => {
    void (async () => {
      if (req.auth?.role === "admin") {
        next();
        return;
      }

      const key = options.keyGenerator(req);
      const redisKey = `${options.prefix}${key}`;

      const currentUsage = await redis.runWithFallback(
        "rate-limit:stream-acquire",
        async () => {
          const totalHits = toNumber(await redis.command("INCR", redisKey), "INCR");
          await redis.command("PEXPIRE", redisKey, String(leaseMs));
          return totalHits;
        },
        async () => 1,
      );

      if (currentUsage > options.max) {
        await redis.runWithFallback(
          "rate-limit:stream-reject",
          async () => {
            const totalHits = toNumber(await redis.command("DECR", redisKey), "DECR");
            if (totalHits <= 0) {
              await redis.command("DEL", redisKey);
            }
          },
          async () => undefined,
        );

        res.setHeader("X-RateLimit-Limit", String(options.max));
        res.setHeader("X-RateLimit-Remaining", "0");
        res.setHeader("X-RateLimit-Reset", String(Math.ceil(Date.now() / 1000)));
        logViolation(logger, req, options.max, key, "concurrent-stream");
        respondTooManyRequests(req, res, options.message);
        return;
      }

      res.setHeader("X-RateLimit-Limit", String(options.max));
      res.setHeader("X-RateLimit-Remaining", String(Math.max(options.max - currentUsage, 0)));
      res.setHeader("X-RateLimit-Reset", String(Math.ceil((Date.now() + leaseMs) / 1000)));

      let released = false;
      const release = async () => {
        if (released) {
          return;
        }

        released = true;

        await redis.runWithFallback(
          "rate-limit:stream-release",
          async () => {
            const totalHits = toNumber(await redis.command("DECR", redisKey), "DECR");
            if (totalHits <= 0) {
              await redis.command("DEL", redisKey);
            }
          },
          async () => undefined,
        );
      };

      res.on("close", () => {
        void release();
      });
      res.on("finish", () => {
        void release();
      });

      next();
    })().catch(next);
  };
}

export function createRateLimiters(
  dependencies: RateLimiterDependencies,
  {
    loginWindowMs = 60_000,
    loginMax = 5,
    registerWindowMs = 60_000,
    registerMax = 3,
    forgotPasswordWindowMs = 60_000,
    forgotPasswordMax = 3,
    resendVerificationWindowMs = 60_000,
    resendVerificationMax = 3,
    chatWindowMs = 60_000,
    chatMax = 20,
    streamMax = 10,
    streamLeaseMs = DEFAULT_STREAM_LEASE_MS,
  }: {
    loginWindowMs?: number;
    loginMax?: number;
    registerWindowMs?: number;
    registerMax?: number;
    forgotPasswordWindowMs?: number;
    forgotPasswordMax?: number;
    resendVerificationWindowMs?: number;
    resendVerificationMax?: number;
    chatWindowMs?: number;
    chatMax?: number;
    streamMax?: number;
    streamLeaseMs?: number;
  } = {},
): RateLimiterSet {
  return {
    loginRateLimiter: createRateLimiter(dependencies, {
      windowMs: loginWindowMs,
      max: loginMax,
      message: "Too many login attempts, please try again later",
      prefix: "rl:login:",
      keyGenerator: keyByIp,
    }),
    registerRateLimiter: createRateLimiter(dependencies, {
      windowMs: registerWindowMs,
      max: registerMax,
      message: "Too many registration attempts, please try again later",
      prefix: "rl:register:",
      keyGenerator: keyByIp,
    }),
    forgotPasswordRateLimiter: createRateLimiter(dependencies, {
      windowMs: forgotPasswordWindowMs,
      max: forgotPasswordMax,
      message: "Too many password reset attempts, please try again later",
      prefix: "rl:forgot-password:",
      keyGenerator: keyByIp,
    }),
    resendVerificationRateLimiter: createRateLimiter(dependencies, {
      windowMs: resendVerificationWindowMs,
      max: resendVerificationMax,
      message: "Too many verification email requests, please try again later",
      prefix: "rl:resend-verification:",
      keyGenerator: keyByIp,
    }),
    chatRateLimiter: createRateLimiter(dependencies, {
      windowMs: chatWindowMs,
      max: chatMax,
      message: "Too many chat requests, please slow down",
      prefix: "rl:chat:",
      keyGenerator: keyByUser,
    }),
    streamRateLimiter: createConcurrentRateLimiter(dependencies, {
      max: streamMax,
      message: "Too many concurrent chat streams, please wait for an active stream to finish",
      prefix: "rl:stream:",
      leaseMs: streamLeaseMs,
      keyGenerator: keyByUser,
    }),
  };
}

function authKey(auth?: AuthContext): string | null {
  if (!auth?.userId) {
    return null;
  }

  return `user:${auth.userId}`;
}

function logViolation(
  logger: RateLimitLogger,
  req: Request,
  limit: number,
  key: string,
  strategy: "fixed-window" | "concurrent-stream",
): void {
  logger.warn(
    {
      requestId: req.id,
      path: req.originalUrl,
      method: req.method,
      rateLimitKey: key,
      limit,
      strategy,
      userId: req.auth?.userId,
      role: req.auth?.role,
      ip: req.ip,
    },
    "Rate limit exceeded",
  );
}

function respondTooManyRequests(req: Request, res: Response<ErrorResponseBody>, message: string): void {
  res.status(429).json({
    error: {
      message,
      statusCode: 429,
      requestId: req.id,
    },
  });
}

function toNumber(reply: RedisCommandReply | null, command: string): number {
  if (typeof reply === "number") {
    return reply;
  }

  if (typeof reply === "string" && /^-?\d+$/.test(reply)) {
    return Number(reply);
  }

  throw new Error(`Unexpected Redis reply for ${command}`);
}
