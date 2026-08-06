import { Router } from 'express';

import { validate } from '@/middleware/validate';

import { createTasksController } from './tasks.controller';
import { createTaskSchema, listTasksSchema, taskParamsSchema } from './tasks.schema';
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
  router.get('/:id', validate({ params: taskParamsSchema }), controller.getById);
  router.post('/', validate({ body: createTaskSchema }), controller.create);

  return router;
};
