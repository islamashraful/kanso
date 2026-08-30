import { ipKeyGenerator, rateLimit, type Options as RateLimitOptions } from 'express-rate-limit';
import type { Request, RequestHandler } from 'express';
import type { Redis } from 'ioredis';
import { RedisStore } from 'rate-limit-redis';

import { TooManyRequestsError } from '@/lib/errors';

export { ipKeyGenerator };

interface RateLimiterParams {
  /**
   * The real Redis connection to count against. Omitted in tests, where the
   * default in-memory store is correct on its own: the test suite runs as one
   * process, so there is no second instance for counts to disagree across —
   * the problem a shared store solves only exists once there is more than one
   * app process, which is exactly the production case. See docs/adr/0020.
   */
  redis?: Redis;
  /** Namespaces this limiter's keys in Redis, so unrelated limiters sharing
   * the same connection never collide. */
  prefix: string;
  windowMs: number;
  max: number;
  keyGenerator: (req: Request) => string;
  /** Count only failed requests. Used by the login limiter so a legitimate,
   * successful sign-in never counts against the caller's budget. */
  skipSuccessfulRequests?: boolean;
}

/**
 * Builds one rate-limit middleware. Every caller of this is a separate
 * limiter with its own key, window and threshold — see docs/adr/0020 for why
 * one shared limiter with conditionals is the wrong shape here.
 *
 * Rejections are thrown as `TooManyRequestsError` rather than handled with
 * express-rate-limit's own default response, so a 429 has the same JSON shape
 * as every other error in the API instead of being the one endpoint that
 * looks different.
 */
export const createRateLimiter = (params: RateLimiterParams): RequestHandler => {
  const options: Partial<RateLimitOptions> = {
    windowMs: params.windowMs,
    limit: params.max,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: params.skipSuccessfulRequests ?? false,
    keyGenerator: (req) => params.keyGenerator(req),
    handler: (_req, _res, next) => next(new TooManyRequestsError()),
  };

  if (params.redis) {
    const redis = params.redis;
    options.store = new RedisStore({
      prefix: `ratelimit:${params.prefix}:`,
      sendCommand: async (...args: string[]) => {
        const [command, ...rest] = args as [string, ...string[]];
        return (await redis.call(command, ...rest)) as string | number | boolean;
      },
    });
  }

  return rateLimit(options);
};
