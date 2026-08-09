import type { RequestHandler } from 'express';

import { UnauthorizedError } from '@/lib/errors';

import type { CreateProjectInput } from './projects.schema';
import type { ProjectsService } from './projects.service';

/**
 * Controllers unwrap the request, call one service method, and shape the
 * response. They hold no logic: if one of these grows past a few lines,
 * something belongs in the service instead.
 */
export const createProjectsController = (projects: ProjectsService) => {
  // `requireAuth` runs before every route here, so `req.auth` is always set.
  // This narrows the optional type without scattering non-null assertions.
  const auth = (req: Parameters<RequestHandler>[0]) => {
    if (!req.auth) throw new UnauthorizedError();
    return req.auth;
  };

  const list: RequestHandler = async (req, res) => {
    res.json(await projects.list(auth(req).organizationId));
  };

  const getById: RequestHandler = async (req, res) => {
    const { id } = req.validated?.params as { id: string };
    res.json(await projects.getById(auth(req).organizationId, id));
  };

  const create: RequestHandler = async (req, res) => {
    const input = req.validated?.body as CreateProjectInput;
    res.status(201).json(await projects.create(auth(req).organizationId, input));
  };

  const remove: RequestHandler = async (req, res) => {
    const { id } = req.validated?.params as { id: string };
    await projects.remove(auth(req).organizationId, id);
    res.status(204).end();
  };

  return { list, getById, create, remove };
};
