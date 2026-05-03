export type RedisConnectionState = "connected" | "connecting" | "reconnecting" | "disconnected";
export type RedisCommandReply = boolean | number | string | null | Array<boolean | number | string | null>;

export interface RedisLoggerLike {
  error(context: Record<string, unknown>, message: string): void;
  warn(context: Record<string, unknown>, message: string): void;
  info?(context: Record<string, unknown>, message: string): void;
}

export interface RedisSetOptions {
  ttlSeconds?: number;
}

export interface RedisClientLike {
  status: string;
  connect(): Promise<unknown>;
  quit(): Promise<unknown>;
  duplicate(): RedisClientLike;
  on(event: string, listener: (...args: unknown[]) => void): RedisClientLike;
  removeListener(event: string, listener: (...args: unknown[]) => void): RedisClientLike;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<"OK" | null>;
  set(key: string, value: string, mode: "EX", durationSeconds: number): Promise<"OK" | null>;
  del(...keys: string[]): Promise<number>;
  publish(channel: string, message: string): Promise<number>;
  subscribe(...channels: string[]): Promise<unknown>;
  unsubscribe(...channels: string[]): Promise<unknown>;
  call(command: string, ...args: string[]): Promise<RedisCommandReply>;
}

export interface RedisConstructorLike {
  new (url: string, options: Record<string, unknown>): RedisClientLike;
}

export interface RedisManagerOptions {
  url: string;
  logger: RedisLoggerLike;
  poolSize?: number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
  maxRetriesPerRequest?: number;
  RedisCtor?: RedisConstructorLike;
}

export interface RedisHealthSnapshot {
  status: RedisConnectionState;
  fallbackEnabled: boolean;
  poolSize: number;
}

export interface TypedRedisClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getStatus(): RedisHealthSnapshot;
  get(key: string): Promise<string | null>;
  getJson<T>(key: string): Promise<T | null>;
  set(key: string, value: string, options?: RedisSetOptions): Promise<"OK" | null>;
  setJson<T>(key: string, value: T, options?: RedisSetOptions): Promise<"OK" | null>;
  del(...keys: string[]): Promise<number>;
  command(command: string, ...args: string[]): Promise<RedisCommandReply>;
  publish(channel: string, message: string): Promise<number>;
  subscribe(channel: string, handler: (message: string) => void): Promise<() => Promise<void>>;
  runWithFallback<T>(operationName: string, operation: () => Promise<T>, fallback: (error: unknown) => T | Promise<T>): Promise<T>;
}
