import { describe, expect, it } from 'bun:test';

import { config } from '@/config';
import { createRedisCache } from '@/lib/cache';
import { createRedisConnection } from '@/lib/queue';

/**
 * This test talks to real Redis, proving `createRedisCache`'s `get`/`set`/
 * `del` actually round-trip through `ioredis` rather than only asserting
 * against the in-memory fake in `test/support.ts`. Same deliberate
 * exception as `notifications.worker.test.ts` — see docs/adr/0016.
 */
describe('createRedisCache against real Redis', () => {
  it('round-trips a value and respects deletion', async () => {
    const redis = createRedisConnection(config);
    const cache = createRedisCache(redis);
    const key = `cache-test:${crypto.randomUUID()}`;

    try {
      expect(await cache.get(key)).toBeNull();

      await cache.set(key, 'hello', 60);
      expect(await cache.get(key)).toBe('hello');

      await cache.del(key);
      expect(await cache.get(key)).toBeNull();
    } finally {
      await redis.quit();
    }
  });
});
