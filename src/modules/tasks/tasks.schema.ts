import { z } from 'zod';

import type { TaskModel as Task } from '@/generated/prisma/models';
import { paginationSchema } from '@/lib/pagination';
import type { Serialized } from '@/lib/serialized';

/**
 * The request contract for tasks. Single source of truth: these schemas drive
 * runtime validation, the TypeScript types below via z.infer, and the OpenAPI
 * document. See docs/adr/0005 and docs/adr/0015.
 *
 * Note there is no organizationId anywhere. It is never accepted from the
 * client; it comes from `req.auth` after membership has been verified.
 */
export const createTaskSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  projectId: z.uuid('Not a valid project id'),
  status: z.enum(['OPEN', 'IN_PROGRESS', 'DONE']).default('OPEN'),
});

/**
 * Filtering, sorting and paging on one schema. `sort` is a closed enum rather
 * than a string: a sort key taken from the query string and handed to
 * `orderBy` unchecked is how a caller reaches a column the API never meant to
 * order by. See docs/adr/0014.
 */
export const listTasksSchema = paginationSchema.extend({
  status: z.enum(['OPEN', 'IN_PROGRESS', 'DONE']).optional(),
  projectId: z.uuid('Not a valid project id').optional(),
  sort: z.enum(['createdAt', 'updatedAt', 'title', 'status']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export const taskParamsSchema = z.object({
  id: z.uuid('Not a valid task id'),
});

/**
 * What a task looks like on the wire. Dates are strings here, not `Date`:
 * this describes the response after `res.json()`, not the row Prisma returns.
 */
export const taskResponseSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    projectId: z.uuid(),
    title: z.string(),
    status: z.enum(['OPEN', 'IN_PROGRESS', 'DONE']),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: 'Task' });

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type ListTasksQuery = z.infer<typeof listTasksSchema>;
export type TaskResponse = z.infer<typeof taskResponseSchema>;

/*
 * Pins the documented response to the Prisma model. Neither line runs: each is
 * an assignability assertion written as a function, and together they fail
 * `bun run typecheck` if the two shapes differ in either direction — a field
 * invented here, or a column added to the model and never documented. Unlike
 * the request schemas above, this one is not a validator, so nothing else
 * would notice it drifting. See lib/serialized.ts for the full reasoning.
 */
const _matchesModel = (task: Serialized<Task>): TaskResponse => task;
const _matchesSchema = (task: TaskResponse): Serialized<Task> => task;
void _matchesModel;
void _matchesSchema;
