import type { RequestHandler } from 'express';

import { UnauthorizedError } from '@/lib/errors';

import type { CreateTaskInput, ListTasksQuery } from './tasks.schema';
import type { TasksService } from './tasks.service';

/**
 * Controllers unwrap the request, call one service method, and shape the
 * response. They hold no logic: if one of these grows past a few lines,
 * something belongs in the service instead.
 */
export const createTasksController = (tasks: TasksService) => {
  // `requireAuth` runs before every route here, so `req.auth` is always set.
  // This narrows the optional type without scattering non-null assertions.
  const auth = (req: Parameters<RequestHandler>[0]) => {
    if (!req.auth) throw new UnauthorizedError();
    return req.auth;
  };

  const list: RequestHandler = async (req, res) => {
    const query = req.validated?.query as ListTasksQuery;
    res.json(await tasks.list(auth(req).organizationId, query));
  };

  const getById: RequestHandler = async (req, res) => {
    const { id } = req.validated?.params as { id: string };
    res.json(await tasks.getById(auth(req).organizationId, id));
  };

  const create: RequestHandler = async (req, res) => {
    const input = req.validated?.body as CreateTaskInput;
    res.status(201).json(await tasks.create(auth(req).organizationId, input));
  };

  return { list, getById, create };
};
