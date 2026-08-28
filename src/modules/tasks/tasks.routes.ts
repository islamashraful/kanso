import { Router } from 'express';

import { validate } from '@/middleware/validate';

import { createTasksController } from './tasks.controller';
import {
  assignTaskSchema,
  createTaskSchema,
  listTasksSchema,
  taskParamsSchema,
  updateTaskStatusSchema,
} from './tasks.schema';
import type { TasksService } from './tasks.service';

/**
 * Declares paths, attaches middleware, delegates. No logic.
 *
 * Auth is applied by the parent router that mounts this one, so it cannot be
 * forgotten on an individual route here.
 */
export const createTasksRouter = (tasks: TasksService): Router => {
  const controller = createTasksController(tasks);
  const router = Router();

  router.get('/', validate({ query: listTasksSchema }), controller.list);
  // Ahead of '/:id': that pattern also matches '/stats' as an id, and
  // Express resolves routes in registration order.
  router.get('/stats', controller.stats);
  router.get('/:id', validate({ params: taskParamsSchema }), controller.getById);
  router.post('/', validate({ body: createTaskSchema }), controller.create);
  router.post(
    '/:id/assign',
    validate({ params: taskParamsSchema, body: assignTaskSchema }),
    controller.assign,
  );
  router.patch(
    '/:id/status',
    validate({ params: taskParamsSchema, body: updateTaskStatusSchema }),
    controller.updateStatus,
  );

  return router;
};
