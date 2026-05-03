import Redis from "ioredis";

import type {
  RedisCommandReply,
  RedisClientLike,
  RedisConnectionState,
  RedisManagerOptions,
  RedisSetOptions,
  TypedRedisClient,
} from "../types/redis";

const DEFAULT_POOL_SIZE = 2;
const DEFAULT_RETRY_BASE_DELAY_MS = 50;
const DEFAULT_RETRY_MAX_DELAY_MS = 2000;
const DEFAULT_MAX_RETRIES_PER_REQUEST = 3;

function mapRedisStatus(status: string): RedisConnectionState {
  if (status === "ready") {
    return "connected";
  }

  if (status === "connect" || status === "connecting") {
    return "connecting";
  }

  if (status === "reconnecting") {
    return "reconnecting";
  }

  return "disconnected";
}

function isRedisConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();

  return (
    message.includes("redis") ||
    message.includes("connect") ||
    message.includes("ready") ||
    message.includes("econnrefused") ||
    message.includes("connection is closed")
  );
}

export function createRedisRetryStrategy(
  retryBaseDelayMs = DEFAULT_RETRY_BASE_DELAY_MS,
  retryMaxDelayMs = DEFAULT_RETRY_MAX_DELAY_MS,
) {
  return (attempt: number) => Math.min(attempt * retryBaseDelayMs, retryMaxDelayMs);
}

export function createRedisClient({
  url,
  logger,
  poolSize = DEFAULT_POOL_SIZE,
  retryBaseDelayMs = DEFAULT_RETRY_BASE_DELAY_MS,
  retryMaxDelayMs = DEFAULT_RETRY_MAX_DELAY_MS,
  maxRetriesPerRequest = DEFAULT_MAX_RETRIES_PER_REQUEST,
  RedisCtor = Redis as unknown as RedisManagerOptions["RedisCtor"],
}: RedisManagerOptions): TypedRedisClient {
  const ResolvedRedisCtor = RedisCtor ?? (Redis as unknown as NonNullable<RedisManagerOptions["RedisCtor"]>);
  const retryStrategy = createRedisRetryStrategy(retryBaseDelayMs, retryMaxDelayMs);
  const baseOptions = {
    lazyConnect: true,
    enableReadyCheck: true,
    maxRetriesPerRequest,
    retryStrategy,
  };

  const commandClients = Array.from({ length: Math.max(poolSize, 1) }, () => new ResolvedRedisCtor(url, baseOptions));
  const publisher = new ResolvedRedisCtor(url, baseOptions);
  const subscriber = publisher.duplicate();
  const allClients = [...commandClients, publisher, subscriber];
  let nextClientIndex = 0;

  function attachListeners(client: RedisClientLike, role: string) {
    client.on("error", (error) => {
      logger.error({ err: error, role }, "Redis connection error");
    });
  }

  commandClients.forEach((client, index) => attachListeners(client, `command-${index}`));
  attachListeners(publisher, "publisher");
  attachListeners(subscriber, "subscriber");

  function selectCommandClient(): RedisClientLike {
    const connectedClients = commandClients.filter((client) => mapRedisStatus(client.status) === "connected");
    const candidatePool = connectedClients.length > 0 ? connectedClients : commandClients;
    const client = candidatePool[nextClientIndex % candidatePool.length];

    nextClientIndex += 1;

    if (!client) {
      throw new Error("Redis command pool is empty");
    }

    return client;
  }

  async function connectClient(client: RedisClientLike, role: string) {
    const normalizedStatus = mapRedisStatus(client.status);

    if (normalizedStatus === "connected" || normalizedStatus === "connecting" || normalizedStatus === "reconnecting") {
      return;
    }

    try {
      await client.connect();
    } catch (error) {
      logger.warn({ err: error, role }, "Redis connection unavailable, continuing in degraded mode");
    }
  }

  async function disconnectClient(client: RedisClientLike, role: string) {
    if (mapRedisStatus(client.status) === "disconnected") {
      return;
    }

    try {
      await client.quit();
    } catch (error) {
      logger.warn({ err: error, role }, "Redis shutdown reported an error");
    }
  }

  async function executeSet(
    client: RedisClientLike,
    key: string,
    value: string,
    options?: RedisSetOptions,
  ): Promise<"OK" | null> {
    if (options?.ttlSeconds) {
      return client.set(key, value, "EX", options.ttlSeconds);
    }

    return client.set(key, value);
  }

  async function runCommand<T>(operation: (client: RedisClientLike) => Promise<T>): Promise<T> {
    return operation(selectCommandClient());
  }

  return {
    async connect() {
      await Promise.all(allClients.map((client, index) => connectClient(client, `client-${index}`)));
    },

    async disconnect() {
      await Promise.all(allClients.map((client, index) => disconnectClient(client, `client-${index}`)));
    },

    getStatus() {
      const statuses = allClients.map((client) => mapRedisStatus(client.status));
      const hasConnectedClient = statuses.includes("connected");
      const hasConnectingClient = statuses.includes("connecting") || statuses.includes("reconnecting");

      return {
        status: hasConnectedClient ? "connected" : hasConnectingClient ? "connecting" : "disconnected",
        fallbackEnabled: !hasConnectedClient,
        poolSize: commandClients.length,
      };
    },

    async get(key: string) {
      return runCommand((client) => client.get(key));
    },

    async getJson<T>(key: string) {
      const value = await runCommand((client) => client.get(key));
      return value ? (JSON.parse(value) as T) : null;
    },

    async set(key: string, value: string, options?: RedisSetOptions) {
      return runCommand((client) => executeSet(client, key, value, options));
    },

    async setJson<T>(key: string, value: T, options?: RedisSetOptions) {
      return runCommand((client) => executeSet(client, key, JSON.stringify(value), options));
    },

    async del(...keys: string[]) {
      return runCommand((client) => client.del(...keys));
    },

    async command(command: string, ...args: string[]): Promise<RedisCommandReply> {
      return runCommand((client) => client.call(command, ...args));
    },

    async publish(channel: string, message: string) {
      return publisher.publish(channel, message);
    },

    async subscribe(channel: string, handler: (message: string) => void) {
      const listener = (incomingChannel: unknown, message: unknown) => {
        if (incomingChannel === channel && typeof message === "string") {
          handler(message);
        }
      };

      subscriber.on("message", listener);
      await subscriber.subscribe(channel);

      return async () => {
        subscriber.removeListener("message", listener);
        await subscriber.unsubscribe(channel);
      };
    },

    async runWithFallback<T>(
      operationName: string,
      operation: () => Promise<T>,
      fallback: (error: unknown) => T | Promise<T>,
    ) {
      try {
        return await operation();
      } catch (error) {
        if (!isRedisConnectionError(error)) {
          throw error;
        }

        logger.warn({ err: error, operationName }, "Redis unavailable, using fallback path");
        return fallback(error);
      }
    },
  };
}
