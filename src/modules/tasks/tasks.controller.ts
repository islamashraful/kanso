import type { RequestHandler } from 'express';

import { UnauthorizedError } from '@/lib/errors';

import type {
  AssignTaskInput,
  CreateTaskInput,
  ListTasksQuery,
  UpdateTaskStatusInput,
} from './tasks.schema';
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

  const assign: RequestHandler = async (req, res) => {
    const { id } = req.validated?.params as { id: string };
    const { assigneeId } = req.validated?.body as AssignTaskInput;
    res.json(await tasks.assign(auth(req).organizationId, id, assigneeId));
  };

  const updateStatus: RequestHandler = async (req, res) => {
    const { id } = req.validated?.params as { id: string };
    const { status } = req.validated?.body as UpdateTaskStatusInput;
    res.json(await tasks.updateStatus(auth(req).organizationId, id, status));
  };

  const stats: RequestHandler = async (req, res) => {
    res.json(await tasks.stats(auth(req).organizationId));
  };

  return { list, getById, create, assign, updateStatus, stats };
};
