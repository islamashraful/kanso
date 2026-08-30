import express from 'express';
import { describe, expect, it } from 'bun:test';
import request from 'supertest';

import { config } from '@/config';
import { createRedisConnection } from '@/lib/queue';
import { createRateLimiter } from '@/lib/rate-limit';

/**
 * This test talks to real Redis, proving the `RedisStore` wiring actually
 * counts and expires hits through `ioredis` rather than only exercising
 * express-rate-limit's own in-memory store, which every other test in the
 * suite uses. Same deliberate exception as `lib/cache.test.ts` and
 * `lib/s3.test.ts` — see docs/adr/0020.
 */
describe('createRateLimiter against real Redis', () => {
  it('counts hits in Redis and blocks once the limit is reached', async () => {
    const redis = createRedisConnection(config);
    const prefix = `rate-limit-test-${crypto.randomUUID()}`;

    const app = express();
    app.use(
      createRateLimiter({
        redis,
        prefix,
        windowMs: 60_000,
        max: 2,
        keyGenerator: () => 'fixed-key',
      }),
    );
    app.get('/', (_req, res) => res.status(200).end());
    // Express only recognises this as error middleware with exactly four
    // parameters — matching the real `createErrorHandler`'s shape.
    app.use(
      (
        _err: unknown,
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction,
      ) => {
        res.status(429).end();
      },
    );

    try {
      expect((await request(app).get('/')).status).toBe(200);
      expect((await request(app).get('/')).status).toBe(200);
      expect((await request(app).get('/')).status).toBe(429);

      const keys = await redis.keys(`ratelimit:${prefix}:*`);
      expect(keys).not.toBeEmpty();
    } finally {
      const keys = await redis.keys(`ratelimit:${prefix}:*`);
      if (keys.length > 0) await redis.del(...keys);
      await redis.quit();
    }
  });
});
