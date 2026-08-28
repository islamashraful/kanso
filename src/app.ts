import express, { type Express } from 'express';

import type { Config } from '@/config';
import type { NotificationsQueue } from '@/jobs/notifications.job';
import type { Db } from '@/lib/db';
import { createErrorHandler } from '@/middleware/error-handler';
import { notFound } from '@/middleware/not-found';
import { createTokens } from '@/lib/tokens';
import { createRequireAuth } from '@/middleware/require-auth';
import { createRequireUser } from '@/middleware/require-user';
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

  // Outside the JSON body parser: liveness and readiness are GET requests
  // with no body, and no reason to depend on middleware that follows.
  const healthService = createHealthService(deps.db, deps.redis);
  app.use(createHealthRouter(healthService));

  app.use(express.json({ limit: '100kb' }));

  const tokens = createTokens(deps.config);
  const requireAuth = createRequireAuth(deps.db, tokens);
  const requireUser = createRequireUser(tokens);

  const authService = createAuthService(deps.db, tokens, deps.config);
  const organizationsService = createOrganizationsService(deps.db);
  const projectsService = createProjectsService(deps.db);
  const tasksService = createTasksService(deps.db, deps.notifications);

  const v1 = express.Router();
  // Mounted without requireAuth: these endpoints issue the credentials the
  // others demand.
  v1.use('/auth', createAuthRouter(authService));
  // requireUser, not requireAuth: creating or listing organizations is what a
  // caller does before they have one to be scoped to. See docs/adr/0012.
  v1.use('/organizations', requireUser, createOrganizationsRouter(organizationsService));
  v1.use('/projects', requireAuth, createProjectsRouter(projectsService));
  v1.use('/tasks', requireAuth, createTasksRouter(tasksService));

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
