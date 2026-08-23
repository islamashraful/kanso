import { Redis } from 'ioredis';

import type { Config } from '@/config';

/**
 * Build the Redis connection BullMQ's queue and worker share.
 *
 * `maxRetriesPerRequest: null` is BullMQ's own requirement, not a style
 * choice: without it, ioredis gives up retrying a blocking command during a
 * connection blip and BullMQ surfaces that as a job failure rather than a
 * transient hiccup.
 */
export const createRedisConnection = (config: Config): Redis =>
  new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
