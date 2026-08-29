import { randomUUID } from 'node:crypto';

import type { RequestHandler } from 'express';
import pinoHttp from 'pino-http';

import { logger } from '@/lib/logger';
import { runWithRequestContext } from '@/lib/request-context';

const httpLogger = pinoHttp({
  logger,
  // Reuse an id a caller (or an upstream proxy) already supplied, so one
  // request keeps one id across service boundaries instead of getting a
  // second one minted here.
  genReqId: (req) => (req.headers['x-request-id'] as string | undefined) ?? randomUUID(),
});

/**
 * Mounted first in `app.ts`, before every other middleware and router.
 *
 * Two things happen per request: pino-http logs a request/response summary
 * line (method, path, status, duration) tagged with the generated id, and
 * that same id is opened as the current `AsyncLocalStorage` context so
 * `getLogger()` — called from a controller, a service, anywhere downstream —
 * returns a logger tagged with it too. See `lib/request-context.ts`.
 */
export const requestLogger: RequestHandler = (req, res, next) => {
  httpLogger(req, res, () => {
    // `ReqId` is typed as `number | string | object` for pino-http's general
    // case, but `genReqId` above always returns a string.
    runWithRequestContext(req.id as string, next);
  });
};
