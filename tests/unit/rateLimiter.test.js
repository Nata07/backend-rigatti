const express = require("express");
const request = require("supertest");

const { createConcurrentRateLimiter, createRateLimiter, keyByIp, keyByUser } = require("../../src/middleware/rateLimiter");

class FakeRateLimitRedis {
  constructor() {
    this.store = new Map();
  }

  async command(command, ...args) {
    const normalizedCommand = command.toUpperCase();
    const key = args[0];

    if (normalizedCommand === "GET") {
      const record = this.store.get(key);
      if (!record || record.expiresAt <= Date.now()) {
        this.store.delete(key);
        return null;
      }

      return String(record.value);
    }

    if (normalizedCommand === "INCR") {
      const record = this.getOrCreateRecord(key);
      record.value += 1;
      return record.value;
    }

    if (normalizedCommand === "DECR") {
      const record = this.getOrCreateRecord(key);
      record.value -= 1;

      if (record.value <= 0) {
        this.store.delete(key);
        return 0;
      }

      return record.value;
    }

    if (normalizedCommand === "DEL") {
      return this.store.delete(key) ? 1 : 0;
    }

    if (normalizedCommand === "PEXPIRE") {
      const record = this.getOrCreateRecord(key);
      record.expiresAt = Date.now() + Number(args[1]);
      return 1;
    }

    if (normalizedCommand === "PTTL") {
      const record = this.store.get(key);
      if (!record) {
        return -2;
      }

      return Math.max(record.expiresAt - Date.now(), 0);
    }

    throw new Error(`Unsupported Redis command: ${command}`);
  }

  async runWithFallback(_operationName, operation) {
    return operation();
  }

  getOrCreateRecord(key) {
    const existing = this.store.get(key);
    if (existing && existing.expiresAt > Date.now()) {
      return existing;
    }

    const created = {
      value: 0,
      expiresAt: Date.now() + 60_000,
    };
    this.store.set(key, created);
    return created;
  }
}

describe("rate limiter middleware", () => {
  let logger;
  let redis;

  beforeEach(() => {
    logger = {
      warn: jest.fn(),
    };
    redis = new FakeRateLimitRedis();
  });

  function createFixedWindowApp(middleware) {
    const app = express();
    app.use((req, _res, next) => {
      req.id = "req-123";
      next();
    });
    app.get("/limited", middleware, (_req, res) => {
      res.json({ ok: true });
    });
    return app;
  }

  it("creates the expected fixed-window configuration and enforces the limit", async () => {
    const app = createFixedWindowApp(
      createRateLimiter(
        { redis, logger },
        {
          windowMs: 60_000,
          max: 1,
          message: "Too many requests",
          prefix: "rl:test:",
          keyGenerator: keyByIp,
        },
      ),
    );

    const first = await request(app).get("/limited");
    const second = await request(app).get("/limited");

    expect(first.status).toBe(200);
    expect(first.headers["x-ratelimit-limit"]).toBe("1");
    expect(first.headers["x-ratelimit-remaining"]).toBe("0");
    expect(second.status).toBe(429);
  });

  it("bypasses fixed-window rate limits for admins", async () => {
    const middleware = createRateLimiter(
      { redis, logger },
      {
        windowMs: 60_000,
        max: 1,
        message: "Too many requests",
        prefix: "rl:test:",
        keyGenerator: keyByUser,
      },
    );
    const app = express();
    app.use((req, _res, next) => {
      req.id = "req-123";
      req.auth = {
        userId: "admin-1",
        companyId: "company-1",
        role: "admin",
      };
      next();
    });
    app.get("/limited", middleware, (_req, res) => {
      res.json({ ok: true });
    });

    const first = await request(app).get("/limited");
    const second = await request(app).get("/limited");

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
  });

  it("adds X-RateLimit headers for allowed concurrent stream requests", async () => {
    const hold = createDeferred();
    const middleware = createConcurrentRateLimiter(
      { redis, logger },
      {
        max: 2,
        leaseMs: 60_000,
        message: "Too many streams",
        prefix: "rl:stream:",
        keyGenerator: keyByUser,
      },
    );
    const app = express();
    app.use((req, _res, next) => {
      req.id = "req-123";
      req.auth = {
        userId: "user-1",
        companyId: "company-1",
        role: "user",
      };
      next();
    });
    app.get("/stream", middleware, async (_req, res) => {
      await hold.promise;
      res.json({ ok: true });
    });

    const responsePromise = request(app).get("/stream");
    await new Promise((resolve) => setTimeout(resolve, 0));
    hold.resolve();
    const response = await responsePromise;

    expect(response.status).toBe(200);
    expect(response.headers["x-ratelimit-limit"]).toBe("2");
    expect(response.headers["x-ratelimit-remaining"]).toBe("1");
    expect(response.headers["x-ratelimit-reset"]).toBeTruthy();
  });

  it("returns the configured 429 payload and logs violations", async () => {
    const app = createFixedWindowApp(
      createRateLimiter(
        { redis, logger },
        {
          windowMs: 60_000,
          max: 1,
          message: "Too many requests",
          prefix: "rl:test:",
          keyGenerator: keyByIp,
        },
      ),
    );

    await request(app).get("/limited");
    const response = await request(app).get("/limited");

    expect(response.status).toBe(429);
    expect(response.body).toEqual({
      error: {
        message: "Too many requests",
        statusCode: 429,
        requestId: "req-123",
      },
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "req-123",
        strategy: "fixed-window",
      }),
      "Rate limit exceeded",
    );
  });
});

function createDeferred() {
  let resolve;
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve;
  });

  return { promise, resolve };
}
