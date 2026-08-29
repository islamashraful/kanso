import { AsyncLocalStorage } from 'node:async_hooks';

import { logger, type Logger } from '@/lib/logger';

interface RequestContext {
  requestId: string;
  logger: Logger;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Runs `fn` with a request-scoped logger available to `getLogger()` anywhere
 * in the call stack it triggers — services included, without threading a
 * logger through every function argument. Called once, by
 * `middleware/request-logger.ts`, at the top of each request.
 */
export const runWithRequestContext = <T>(requestId: string, fn: () => T): T =>
  // `reqId`, not `requestId`, to match the field name pino-http's own
  // request/response summary lines already use for the same value.
  storage.run({ requestId, logger: logger.child({ reqId: requestId }) }, fn);

/**
 * The current request's logger, or the base logger outside of a request
 * (a script, the worker entry point, module init). Services call this
 * directly rather than receiving a logger as a dependency: logging is
 * cross-cutting infrastructure, not something a test would ever fake or
 * assert against, so it doesn't belong in `Deps`. See docs/adr/0019
 * (deviates from the injection convention in docs/adr/0003, deliberately).
 */
export const getLogger = (): Logger => storage.getStore()?.logger ?? logger;
