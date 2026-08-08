import { Router } from 'express';

import { validate } from '@/middleware/validate';

import { createOrganizationsController } from './organizations.controller';
import { createOrganizationSchema } from './organizations.schema';
import type { OrganizationsService } from './organizations.service';

/**
 * Declares paths, attaches middleware, delegates. No logic.
 *
 * Mounted under `requireUser` rather than `requireAuth` by the composition
 * root: a caller creating their first organization has no membership to be
 * checked against. See docs/adr/0012.
 */
export const createOrganizationsRouter = (organizations: OrganizationsService): Router => {
  const controller = createOrganizationsController(organizations);
  const router = Router();

  router.get('/', controller.list);
  router.post('/', validate({ body: createOrganizationSchema }), controller.create);

  return router;
};
