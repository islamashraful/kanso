import express, { type Express } from 'express';
import type { Redis } from 'ioredis';

import type { Config } from '@/config';
import type { NotificationsQueue } from '@/jobs/notifications.job';
import type { Cache } from '@/lib/cache';
import type { Db } from '@/lib/db';
import { createRateLimiter, ipKeyGenerator } from '@/lib/rate-limit';
import type { ObjectStore } from '@/lib/s3';
import { createErrorHandler } from '@/middleware/error-handler';
import { notFound } from '@/middleware/not-found';
import { requestLogger } from '@/middleware/request-logger';
import { createTokens } from '@/lib/tokens';
import { createRequireAuth } from '@/middleware/require-auth';
import { createRequireUser } from '@/middleware/require-user';
import { createAttachmentsRouter } from '@/modules/attachments/attachments.routes';
import { createAttachmentsService } from '@/modules/attachments/attachments.service';
import { createAuthRouter } from '@/modules/auth/auth.routes';
import { createAuthService } from '@/modules/auth/auth.service';
import { createHealthRouter } from '@/modules/health/health.routes';
import { createHealthService, type Pingable } from '@/modules/health/health.service';
import { createOrganizationsRouter } from '@/modules/organizations/organizations.routes';
import { createOrganizationsService } from '@/modules/organizations/organizations.service';
import { createProjectsRouter } from '@/modules/projects/projects.routes';
import { createProjectsService } from '@/modules/projects/projects.service';
import { createTasksRouter } from '@/modules/tasks/tasks.routes';
import { createTasksService } from '@/modules/tasks/tasks.service';
import { createOpenApiRouter } from '@/openapi/openapi.routes';

/**
 * Everything the application needs from the outside world. Dependencies are
 * passed in rather than imported directly, so tests can substitute them
 * without module mocking. See docs/adr/0003.
 */
export interface Deps {
  config: Config;
  db: Db;
  notifications: NotificationsQueue;
  redis: Pingable;
  cache: Cache;
  objectStore: ObjectStore;
  /**
   * The real Redis connection, for rate limiting specifically — `redis`
   * above is deliberately narrowed to `Pingable` for health checks and
   * cannot send the raw commands a Redis-backed rate-limit store needs.
   * Optional because tests omit it: see `createRateLimiter`'s `redis` param.
   */
  redisClient?: Redis;
}

/**
 * Build the application without starting it.
 *
 * This is the composition root: the one place services are constructed and
 * wired to routers, so the whole object graph is visible on one screen.
 *
 * Deliberately never calls `listen()`: that belongs to `server.ts`. Keeping the
 * two separate means integration tests can drive the app in-process, and the
 * process concerns (ports, signals, shutdown) live in exactly one place.
 */
export const createApp = (deps: Deps): Express => {
  const app = express();

  // First, so every request — including the two below — gets a request id
  // and a log line, regardless of what later middleware does with it.
  app.use(requestLogger);

  // Outside the JSON body parser: liveness and readiness are GET requests
  // with no body, and no reason to depend on middleware that follows.
  const healthService = createHealthService(deps.db, deps.redis);
  app.use(createHealthRouter(healthService));

  // A blunt, loose net over the whole API: catches a runaway script or a
  // flood of unauthenticated traffic before it reaches auth, the database,
  // or anything else downstream — not tuned to any one endpoint. Keyed by IP
  // since a request this early may carry no credentials at all. See
  // docs/adr/0020.
  app.use(
    createRateLimiter({
      redis: deps.redisClient,
      prefix: 'global',
      windowMs: 60_000,
      max: 300,
      keyGenerator: (req) => ipKeyGenerator(req.ip ?? ''),
    }),
  );

  app.use(express.json({ limit: '100kb' }));

  const tokens = createTokens(deps.config);
  const requireAuth = createRequireAuth(deps.db, tokens);
  const requireUser = createRequireUser(tokens);

  const authService = createAuthService(deps.db, tokens, deps.config);
  const organizationsService = createOrganizationsService(deps.db);
  const projectsService = createProjectsService(deps.db, deps.cache);
  const tasksService = createTasksService(deps.db, deps.notifications, deps.cache);
  const attachmentsService = createAttachmentsService(deps.db, deps.objectStore);

  // Precise, on top of the global net: brute-forcing one account's password
  // is still capped, but two different people on the same IP (shared
  // Wi-Fi, an office, a VPN) never share a budget, because the key includes
  // the email being attempted, not just the IP. Successful logins are not
  // counted, so a legitimate user is never penalised for other traffic
  // against the same key. See docs/adr/0020.
  const loginLimiter = createRateLimiter({
    redis: deps.redisClient,
    prefix: 'login',
    windowMs: 15 * 60_000,
    max: 5,
    // Only this limiter behaves this way — the global and presign limiters
    // below have no `skipSuccessfulRequests`, so for them a request simply
    // counts and that's the end of it. Setting this flag here changes that:
    // every request still counts immediately, exactly the same as normal,
    // but once the response goes out, express-rate-limit checks its status
    // code (its own default rule: under 400 is a "success") and, if it was
    // a success, un-counts the request it just counted. We never told it
    // what counts as success or failure — this is the library's built-in
    // rule, not something this codebase decides.
    skipSuccessfulRequests: true,
    keyGenerator: (req) => {
      const email = (req.validated?.body as { email?: string } | undefined)?.email ?? '';
      return `${ipKeyGenerator(req.ip ?? '')}:${email}`;
    },
  });

  // The presign endpoint hands out a signed voucher for a real S3 write, so
  // it gets its own, tighter limit on top of the global net, keyed by the
  // caller's verified identity rather than IP — this only runs after
  // `requireAuth`, so `req.auth` is always set. See docs/adr/0018 and
  // docs/adr/0020.
  const presignLimiter = createRateLimiter({
    redis: deps.redisClient,
    prefix: 'presign',
    windowMs: 10 * 60_000,
    max: 20,
    keyGenerator: (req) => req.auth!.userId,
  });

  const v1 = express.Router();
  // Mounted without requireAuth: these endpoints issue the credentials the
  // others demand.
  v1.use('/auth', createAuthRouter(authService, loginLimiter));
  // requireUser, not requireAuth: creating or listing organizations is what a
  // caller does before they have one to be scoped to. See docs/adr/0012.
  v1.use('/organizations', requireUser, createOrganizationsRouter(organizationsService));
  v1.use('/projects', requireAuth, createProjectsRouter(projectsService));
  v1.use('/tasks', requireAuth, createTasksRouter(tasksService));
  v1.use(
    '/tasks/:taskId/attachments',
    requireAuth,
    createAttachmentsRouter(attachmentsService, presignLimiter),
  );

  app.use('/api/v1', v1);

  // Outside /api/v1 and outside auth: the spec describes the shape of the API,
  // not any tenant's data. See docs/adr/0015.
  app.use(createOpenApiRouter());

  // Order matters: unmatched paths become a NotFoundError, and the error
  // handler is last so every failure passes through it.
  app.use(notFound);
  app.use(createErrorHandler(deps.config));

  return app;
};
