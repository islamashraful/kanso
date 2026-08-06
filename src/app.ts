import express, { type Express } from 'express';

import type { Config } from '@/config';
import type { Db } from '@/lib/db';
import { createErrorHandler } from '@/middleware/error-handler';
import { notFound } from '@/middleware/not-found';
import { createRequireAuth } from '@/middleware/require-auth';
import { createTasksRouter } from '@/modules/tasks/tasks.routes';
import { createTasksService } from '@/modules/tasks/tasks.service';

/**
 * Everything the application needs from the outside world. Dependencies are
 * passed in rather than imported directly, so tests can substitute them
 * without module mocking. See docs/adr/0003.
 */
export interface Deps {
  config: Config;
  db: Db;
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

  app.use(express.json({ limit: '100kb' }));

  const requireAuth = createRequireAuth(deps.db);
  const tasksService = createTasksService(deps.db);

  const v1 = express.Router();
  v1.use('/tasks', requireAuth, createTasksRouter(tasksService));

  app.use('/api/v1', v1);

  // Order matters: unmatched paths become a NotFoundError, and the error
  // handler is last so every failure passes through it.
  app.use(notFound);
  app.use(createErrorHandler(deps.config));

  return app;
};
