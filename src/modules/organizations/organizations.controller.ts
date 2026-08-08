import type { RequestHandler } from 'express';

import { UnauthorizedError } from '@/lib/errors';

import type { CreateOrganizationInput } from './organizations.schema';
import type { OrganizationsService } from './organizations.service';

/**
 * Unwraps the request, calls one service method, shapes the response.
 *
 * Reads `req.user` rather than `req.auth`: these routes are guarded by
 * `requireUser`, which proves identity without naming an organization.
 */
export const createOrganizationsController = (organizations: OrganizationsService) => {
  const user = (req: Parameters<RequestHandler>[0]) => {
    if (!req.user) throw new UnauthorizedError();
    return req.user;
  };

  const list: RequestHandler = async (req, res) => {
    res.json(await organizations.listForUser(user(req).id));
  };

  const create: RequestHandler = async (req, res) => {
    const input = req.validated?.body as CreateOrganizationInput;
    res.status(201).json(await organizations.create(user(req).id, input));
  };

  return { list, create };
};
