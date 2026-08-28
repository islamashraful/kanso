import { describe, expect, it } from 'bun:test';

import { db } from '@/test/support';

import { createHealthService, type Pingable } from './health.service';

/**
 * A fake Redis can't fail by disconnecting a real one, but it can reject on
 * command the way a down Redis would — enough to prove one dependency
 * failing doesn't hide the other, which is the actual behavior worth
 * covering here. The real-database, real-Redis success path is
 * `health.readiness.test.ts`.
 */
describe('checkReadiness', () => {
  it('reports error and identifies which dependency failed', async () => {
    const brokenRedis: Pingable = {
      ping: () => Promise.reject(new Error('connection refused')),
    };
    const service = createHealthService(db, brokenRedis);

    const result = await service.checkReadiness();

    expect(result).toEqual({
      status: 'error',
      checks: { database: 'ok', redis: 'error' },
    });
  });
});
