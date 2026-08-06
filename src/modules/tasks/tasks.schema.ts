import { z } from 'zod';

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
  status: z.enum(['OPEN', 'IN_PROGRESS', 'DONE']).default('OPEN'),
});

export const listTasksSchema = z.object({
  status: z.enum(['OPEN', 'IN_PROGRESS', 'DONE']).optional(),
});

export const taskParamsSchema = z.object({
  id: z.uuid('Not a valid task id'),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type ListTasksQuery = z.infer<typeof listTasksSchema>;
