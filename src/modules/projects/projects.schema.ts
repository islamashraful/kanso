import { z } from 'zod';

import type { ProjectModel as Project } from '@/generated/prisma/models';
import { paginationSchema } from '@/lib/pagination';
import type { Serialized } from '@/lib/serialized';

/**
 * The request contract for projects. Single source of truth: these schemas
 * drive runtime validation, the TypeScript types below via z.infer, and the
 * OpenAPI document. See docs/adr/0005 and docs/adr/0015.
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

/** What a project looks like on the wire. Dates are strings, as `res.json()`
 * leaves them, not the `Date` Prisma returns. */
export const projectResponseSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    name: z.string(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: 'Project' });

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type ListProjectsQuery = z.infer<typeof listProjectsSchema>;
export type ProjectResponse = z.infer<typeof projectResponseSchema>;

/*
 * Pins the documented response to the Prisma model. Neither line runs: each is
 * an assignability assertion written as a function, and together they fail
 * `bun run typecheck` if the two shapes differ in either direction — a field
 * invented here, or a column added to the model and never documented. Unlike
 * the request schemas above, this one is not a validator, so nothing else
 * would notice it drifting. See lib/serialized.ts for the full reasoning.
 */
const _matchesModel = (project: Serialized<Project>): ProjectResponse => project;
const _matchesSchema = (project: ProjectResponse): Serialized<Project> => project;
void _matchesModel;
void _matchesSchema;
