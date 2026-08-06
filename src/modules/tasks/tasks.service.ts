import type { TaskModel as Task } from '@/generated/prisma/models';
import type { Db } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';

import type { CreateTaskInput, ListTasksQuery } from './tasks.schema';

/**
 * Task business logic.
 *
 * Knows nothing about HTTP: no `req`, no `res`, no status codes. It takes plain
 * arguments, returns plain data, and throws AppError subclasses. The db client
 * arrives as an argument rather than an import, so tests can substitute it.
 * See docs/adr/0001 and docs/adr/0003.
 *
 * Every method takes `organizationId` first and every query filters on it. That
 * repetition is deliberate: it makes an unscoped query visually obvious in
 * review, which is the failure that would leak one tenant's data to another.
 */
export const createTasksService = (db: Db) => ({
  async list(organizationId: string, query: ListTasksQuery): Promise<Task[]> {
    return db.task.findMany({
      where: { organizationId, ...(query.status ? { status: query.status } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  },

  async getById(organizationId: string, id: string): Promise<Task> {
    const task = await db.task.findFirst({ where: { id, organizationId } });

    // findFirst with both conditions, not findUnique on id alone: a task
    // belonging to another organization must be indistinguishable from one
    // that does not exist, or the 404-vs-403 difference leaks its existence.
    if (!task) throw new NotFoundError('Task not found');

    return task;
  },

  async create(organizationId: string, input: CreateTaskInput): Promise<Task> {
    return db.task.create({
      data: { organizationId, title: input.title, status: input.status },
    });
  },
});

export type TasksService = ReturnType<typeof createTasksService>;
