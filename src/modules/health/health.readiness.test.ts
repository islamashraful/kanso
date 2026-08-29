import { describe, expect, it } from 'bun:test';
import request from 'supertest';

import { createApp } from '@/app';
import { config } from '@/config';
import { createRedisConnection } from '@/lib/queue';
import { cache, db, notifications, objectStore } from '@/test/support';

/**
 * This test talks to a real Redis connection, proving `/health/ready`
 * actually reaches it rather than only asserting against the fake in
 * `test/support.ts`. Same deliberate exception as
 * `notifications.worker.test.ts` — see docs/adr/0016.
 */
describe('GET /health/ready against real Redis', () => {
  it('reports ok', async () => {
    const redis = createRedisConnection(config);
    const app = createApp({ config, db, notifications, redis, cache, objectStore });

    try {
      const res = await request(app).get('/health/ready');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        status: 'ok',
        checks: { database: 'ok', redis: 'ok' },
      });
    } finally {
      await redis.quit();
    }
  });
});
