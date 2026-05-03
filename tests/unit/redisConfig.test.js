const { createRedisClient, createRedisRetryStrategy } = require("../../src/config/redis");

class FakeRedis {
  static instances = [];
  static sharedStore = new Map();
  static failConnectCount = 0;

  constructor(url, options) {
    this.url = url;
    this.options = options;
    this.status = "wait";
    this.listeners = new Map();
    this.subscriptions = new Set();
    FakeRedis.instances.push(this);
  }

  duplicate() {
    return new FakeRedis(this.url, this.options);
  }

  on(event, listener) {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  removeListener(event, listener) {
    const listeners = this.listeners.get(event) ?? [];
    this.listeners.set(
      event,
      listeners.filter((registered) => registered !== listener),
    );
    return this;
  }

  emit(event, ...args) {
    const listeners = this.listeners.get(event) ?? [];
    listeners.forEach((listener) => listener(...args));
  }

  async connect() {
    if (FakeRedis.failConnectCount > 0) {
      FakeRedis.failConnectCount -= 1;
      throw new Error("Redis connect ECONNREFUSED");
    }

    this.status = "ready";
  }

  async quit() {
    this.status = "end";
    return "OK";
  }

  async get(key) {
    return FakeRedis.sharedStore.has(key) ? FakeRedis.sharedStore.get(key) : null;
  }

  async set(key, value, mode, durationSeconds) {
    FakeRedis.sharedStore.set(key, value);
    this.lastSetArgs = [key, value, mode, durationSeconds];
    return "OK";
  }

  async del(...keys) {
    let deleted = 0;
    keys.forEach((key) => {
      if (FakeRedis.sharedStore.delete(key)) {
        deleted += 1;
      }
    });
    return deleted;
  }

  async publish(channel, message) {
    FakeRedis.instances.forEach((instance) => {
      if (instance.subscriptions.has(channel)) {
        instance.emit("message", channel, message);
      }
    });
    return 1;
  }

  async subscribe(...channels) {
    channels.forEach((channel) => this.subscriptions.add(channel));
    return channels.length;
  }

  async unsubscribe(...channels) {
    channels.forEach((channel) => this.subscriptions.delete(channel));
    return channels.length;
  }

  async call(command, ...args) {
    const normalizedCommand = command.toUpperCase();

    if (normalizedCommand === "GET") {
      return this.get(args[0]);
    }

    if (normalizedCommand === "INCR") {
      const currentValue = Number((await this.get(args[0])) ?? 0) + 1;
      await this.set(args[0], String(currentValue));
      return currentValue;
    }

    if (normalizedCommand === "DECR") {
      const currentValue = Number((await this.get(args[0])) ?? 0) - 1;
      if (currentValue <= 0) {
        await this.del(args[0]);
        return 0;
      }

      await this.set(args[0], String(currentValue));
      return currentValue;
    }

    if (normalizedCommand === "DEL") {
      return this.del(...args);
    }

    if (normalizedCommand === "PEXPIRE") {
      return 1;
    }

    if (normalizedCommand === "PTTL") {
      return 60000;
    }

    throw new Error(`Unsupported Redis command in test double: ${command}`);
  }
}

describe("createRedisRetryStrategy", () => {
  it("caps retry backoff at the configured maximum", () => {
    const retryStrategy = createRedisRetryStrategy(50, 2000);

    expect(retryStrategy(1)).toBe(50);
    expect(retryStrategy(10)).toBe(500);
    expect(retryStrategy(100)).toBe(2000);
  });
});

describe("createRedisClient", () => {
  let logger;

  beforeEach(() => {
    FakeRedis.instances = [];
    FakeRedis.sharedStore = new Map();
    FakeRedis.failConnectCount = 0;
    logger = {
      error: jest.fn(),
      warn: jest.fn(),
    };
  });

  it("creates a Redis pool with retry settings and pub/sub support", async () => {
    const redis = createRedisClient({
      url: "redis://localhost:6379",
      logger,
      poolSize: 3,
      RedisCtor: FakeRedis,
    });

    await redis.connect();

    expect(FakeRedis.instances).toHaveLength(5);
    expect(FakeRedis.instances[0].url).toBe("redis://localhost:6379");
    expect(FakeRedis.instances[0].options.maxRetriesPerRequest).toBe(3);
    expect(FakeRedis.instances[0].options.lazyConnect).toBe(true);
    expect(FakeRedis.instances[0].options.enableReadyCheck).toBe(true);
    expect(FakeRedis.instances[0].options.retryStrategy(50)).toBe(2000);
    expect(redis.getStatus()).toEqual({
      status: "connected",
      fallbackEnabled: false,
      poolSize: 3,
    });
  });

  it("logs Redis connection errors emitted by the client", () => {
    createRedisClient({
      url: "redis://localhost:6379",
      logger,
      RedisCtor: FakeRedis,
    });

    FakeRedis.instances[0].emit("error", new Error("boom"));

    expect(logger.error).toHaveBeenCalledWith(
      {
        err: expect.any(Error),
        role: "command-0",
      },
      "Redis connection error",
    );
  });

  it("uses the fallback path for non-critical operations when Redis is unavailable", async () => {
    const redis = createRedisClient({
      url: "redis://localhost:6379",
      logger,
      RedisCtor: FakeRedis,
    });

    const result = await redis.runWithFallback(
      "cache-read",
      async () => {
        throw new Error("Redis connection is closed");
      },
      async () => "fallback-value",
    );

    expect(result).toBe("fallback-value");
    expect(logger.warn).toHaveBeenCalledWith(
      {
        err: expect.any(Error),
        operationName: "cache-read",
      },
      "Redis unavailable, using fallback path",
    );
  });

  it("rethrows non-connection errors instead of hiding them behind the fallback", async () => {
    const redis = createRedisClient({
      url: "redis://localhost:6379",
      logger,
      RedisCtor: FakeRedis,
    });

    await expect(
      redis.runWithFallback(
        "cache-read",
        async () => {
          throw new Error("validation failed");
        },
        async () => "fallback-value",
      ),
    ).rejects.toThrow("validation failed");
  });
});
