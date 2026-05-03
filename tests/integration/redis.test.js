const { createRedisClient } = require("../../src/config/redis");

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
}

describe("Redis integration contract", () => {
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

  it("supports basic set/get/del operations with typed JSON helpers", async () => {
    const redis = createRedisClient({
      url: "redis://localhost:6379",
      logger,
      poolSize: 2,
      RedisCtor: FakeRedis,
    });

    await redis.connect();
    await redis.set("cache:key", "value");
    await redis.setJson("cache:json", { enabled: true }, { ttlSeconds: 60 });

    expect(await redis.get("cache:key")).toBe("value");
    expect(await redis.getJson("cache:json")).toEqual({ enabled: true });
    expect(FakeRedis.instances[1].lastSetArgs).toEqual(["cache:json", "{\"enabled\":true}", "EX", 60]);
    expect(await redis.del("cache:key", "cache:json")).toBe(2);
    expect(await redis.get("cache:key")).toBeNull();
  });

  it("reports degraded health until a later reconnection succeeds", async () => {
    FakeRedis.failConnectCount = 4;
    const redis = createRedisClient({
      url: "redis://localhost:6379",
      logger,
      poolSize: 2,
      RedisCtor: FakeRedis,
    });

    await redis.connect();

    expect(redis.getStatus()).toEqual({
      status: "disconnected",
      fallbackEnabled: true,
      poolSize: 2,
    });
    expect(logger.warn).toHaveBeenCalled();

    await redis.connect();

    expect(redis.getStatus()).toEqual({
      status: "connected",
      fallbackEnabled: false,
      poolSize: 2,
    });
  });

  it("supports pub/sub subscriptions for future rate limit and cache invalidation features", async () => {
    const redis = createRedisClient({
      url: "redis://localhost:6379",
      logger,
      RedisCtor: FakeRedis,
    });
    const handler = jest.fn();

    await redis.connect();
    const unsubscribe = await redis.subscribe("events", handler);
    await redis.publish("events", "payload");

    expect(handler).toHaveBeenCalledWith("payload");

    await unsubscribe();
    await redis.publish("events", "second-payload");

    expect(handler).toHaveBeenCalledTimes(1);
  });
});
