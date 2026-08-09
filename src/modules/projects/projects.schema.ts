import { z } from 'zod';

import { paginationSchema } from '@/lib/pagination';

/**
 * The request contract for projects. Single source of truth: these schemas
 * drive runtime validation, the TypeScript types below via z.infer, and the
 * OpenAPI spec in week 2. See docs/adr/0005.
 *
 * As with tasks, there is no organizationId anywhere. It is never accepted from
 * the client; it comes from `req.auth` after membership has been verified.
 */
export const createProjectSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
});

export const projectParamsSchema = z.object({
  id: z.uuid('Not a valid project id'),
});

/** Paged and sorted like tasks, from the same shared schema. See docs/adr/0014. */
export const listProjectsSchema = paginationSchema.extend({
  sort: z.enum(['createdAt', 'updatedAt', 'name']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type ListProjectsQuery = z.infer<typeof listProjectsSchema>;
