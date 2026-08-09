import { z } from 'zod';
import type { ZodOpenApiResponseObject } from 'zod-openapi';

import { DEFAULT_LIMIT } from '@/lib/pagination';

/**
 * The pieces every path refers to.
 *
 * Metadata rides on the schemas themselves via Zod 4's native `.meta()`, so
 * nothing here patches Zod and no schema has to be defined in a particular
 * order to pick up a method. See docs/adr/0015.
 */

/** The name paths refer to the bearer scheme by, rather than a loose string. */
export const BEARER_AUTH = 'bearerAuth';

/**
 * The error body every failure returns, from the one error handler.
 * `details` is present only on a validation failure. See docs/adr/0006.
 */
export const errorResponseSchema = z
  .object({
    error: z.object({
      code: z.string().meta({ example: 'NOT_FOUND' }),
      message: z.string().meta({ example: 'Task not found' }),
      details: z
        .array(z.object({ path: z.string(), message: z.string() }))
        .optional()
        .meta({ description: 'Present only on a validation failure.' }),
    }),
  })
  .meta({ id: 'Error' });

export const pageMetaSchema = z
  .object({
    page: z.int().meta({ example: 1 }),
    limit: z.int().meta({ example: DEFAULT_LIMIT }),
    total: z.int().meta({ example: 42 }),
    totalPages: z.int().meta({ example: 3 }),
    hasNext: z.boolean(),
    hasPrevious: z.boolean(),
  })
  .meta({ id: 'PageMeta' });

/**
 * The `{ data, meta }` envelope wrapped around whichever row schema is being
 * paged. Named per collection, so the spec shows `TaskPage` rather than the
 * same anonymous object inlined at every list endpoint. See docs/adr/0014.
 */
export const pagedSchema = <T extends z.ZodType>(id: string, rows: T) =>
  z.object({ data: z.array(rows), meta: pageMetaSchema }).meta({ id });

/**
 * The header naming which organization the caller is acting in.
 *
 * Not a security scheme, deliberately. Identity comes from the token;
 * authorization comes from a membership row read on every request, and this
 * header only names which one to look for. See docs/adr/0011.
 */
export const orgHeaderSchema = z.object({
  'x-org-id': z.uuid().meta({
    description:
      'The organization to act in. Rejected with 404 unless the caller has a membership in it.',
  }),
});

/** A failure response, ready to drop into a path's `responses`. */
export const errorResponse = (description: string): ZodOpenApiResponseObject => ({
  description,
  content: { 'application/json': { schema: errorResponseSchema } },
});

/** A success response carrying a body. */
export const jsonResponse = (description: string, schema: z.ZodType): ZodOpenApiResponseObject => ({
  description,
  content: { 'application/json': { schema } },
});

/**
 * The failures any organization-scoped path can produce, spread into each
 * one's responses so the list is stated once.
 */
export const scopedFailures = {
  401: errorResponse('Missing or invalid access token.'),
  404: errorResponse('No membership in the organization named by `x-org-id`.'),
  422: errorResponse('Validation failed.'),
};
