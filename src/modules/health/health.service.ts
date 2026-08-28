import type { Db } from '@/lib/db';

/**
 * The narrow shape readiness needs from Redis: something that can be pinged.
 * A real `ioredis` client satisfies this structurally, and a test fake can
 * implement it without opening a connection. Mirrors `NotificationsQueue`'s
 * reasoning in docs/adr/0016 — depend on the operation used, not the client.
 */
export interface Pingable {
  ping(): Promise<unknown>;
}

export interface HealthStatus {
  status: 'ok' | 'error';
  checks: {
    database: 'ok' | 'error';
    redis: 'ok' | 'error';
  };
}

/**
 * Readiness checks the app can actually reach its dependencies, not just that
 * the process is running — what distinguishes it from liveness. Both checks
 * run concurrently and independently: one failing must not hide whether the
 * other also failed, which `Promise.allSettled` (not `Promise.all`) is what
 * makes true.
 */
export const createHealthService = (db: Db, redis: Pingable) => ({
  async checkReadiness(): Promise<HealthStatus> {
    const [database, redisCheck] = await Promise.allSettled([db.$queryRaw`SELECT 1`, redis.ping()]);

    const checks = {
      database: database.status === 'fulfilled' ? ('ok' as const) : ('error' as const),
      redis: redisCheck.status === 'fulfilled' ? ('ok' as const) : ('error' as const),
    };

    return {
      status: checks.database === 'ok' && checks.redis === 'ok' ? 'ok' : 'error',
      checks,
    };
  },
});

export type HealthService = ReturnType<typeof createHealthService>;
