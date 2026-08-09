import { z } from 'zod';

import { paginationSchema } from '@/lib/pagination';

/**
 * The request contract for tasks. Single source of truth: these schemas drive
 * runtime validation, the TypeScript types below via z.infer, and the OpenAPI
 * spec in week 2. See docs/adr/0005.
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

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type ListTasksQuery = z.infer<typeof listTasksSchema>;
