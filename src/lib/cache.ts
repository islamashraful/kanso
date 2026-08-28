import type { Redis } from 'ioredis';

/**
 * The narrow shape a cache consumer actually needs, rather than a raw
 * `ioredis` client. Same reasoning as `NotificationsQueue` (docs/adr/0016)
 * and `Pingable`: depend on the operations used, so a test can fake them
 * without opening a connection.
 */
export interface Cache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
}

/**
 * Backs `Cache` with a real Redis connection.
 *
 * `EX` on every `set` is a backstop against a missed invalidation, not the
 * freshness mechanism — callers are expected to `del` the key the moment the
 * data behind it changes. See `tasks.service.ts`'s `stats` method for the
 * invalidation this exists to make honest.
 */
export const createRedisCache = (redis: Redis): Cache => ({
  async get(key) {
    return redis.get(key);
  },
  async set(key, value, ttlSeconds) {
    await redis.set(key, value, 'EX', ttlSeconds);
  },
  async del(key) {
    await redis.del(key);
  },
});
