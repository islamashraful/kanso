import { Router } from 'express';

import { requireOrgRole } from '@/middleware/require-org-role';
import { validate } from '@/middleware/validate';

import { createProjectsController } from './projects.controller';
import { createProjectSchema, listProjectsSchema, projectParamsSchema } from './projects.schema';
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

  router.get('/', validate({ query: listProjectsSchema }), controller.list);
  router.get('/:id', validate({ params: projectParamsSchema }), controller.getById);
  router.post('/', validate({ body: createProjectSchema }), controller.create);

  // Deleting a project cascades to its tasks (docs/adr/0010), so it takes more
  // than membership. The requirement is declared here, beside the route, not
  // checked inside the controller. See docs/adr/0013.
  router.delete(
    '/:id',
    requireOrgRole('ADMIN'),
    validate({ params: projectParamsSchema }),
    controller.remove,
  );

  return router;
};
