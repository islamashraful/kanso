import { Router } from 'express';

import { validate } from '@/middleware/validate';

import { createProjectsController } from './projects.controller';
import { createProjectSchema, projectParamsSchema } from './projects.schema';
import type { ProjectsService } from './projects.service';

/**
 * Declares paths, attaches middleware, delegates. No logic.
 *
 * Auth is applied by the parent router that mounts this one, so it cannot be
 * forgotten on an individual route here.
 */
export const createProjectsRouter = (projects: ProjectsService): Router => {
  const controller = createProjectsController(projects);
  const router = Router();

  router.get('/', controller.list);
  router.get('/:id', validate({ params: projectParamsSchema }), controller.getById);
  router.post('/', validate({ body: createProjectSchema }), controller.create);

  return router;
};
