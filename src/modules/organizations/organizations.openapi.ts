import type { ZodOpenApiPathsObject } from 'zod-openapi';

import { errorResponse, jsonResponse } from '@/openapi/components';

import {
  createOrganizationSchema,
  organizationMembershipResponseSchema,
  organizationResponseSchema,
} from './organizations.schema';

/**
 * Documents the organization routes. See docs/adr/0015.
 *
 * The only scoped module with no `x-org-id` header: these are the two routes a
 * caller uses before they have an organization to be scoped to, so they are
 * guarded by identity alone. See docs/adr/0012.
 */
export const organizationPaths: ZodOpenApiPathsObject = {
  '/api/v1/organizations': {
    get: {
      tags: ['Organizations'],
      summary: "List the caller's organizations",
      description:
        "Not paged, unlike the other collections: the list is bounded by the caller's own memberships rather than by tenant activity. See docs/adr/0014.",
      responses: {
        200: jsonResponse(
          'Every organization the caller belongs to, each with their role in it.',
          organizationMembershipResponseSchema.array(),
        ),
        401: errorResponse('Missing or invalid access token.'),
      },
    },
    post: {
      tags: ['Organizations'],
      summary: 'Create an organization',
      description:
        'Writes the organization, an `OWNER` membership for the caller, and a default project in one transaction. All three or none, and the role is not accepted from the client. See docs/adr/0012.',
      requestBody: { content: { 'application/json': { schema: createOrganizationSchema } } },
      responses: {
        201: jsonResponse('The created organization.', organizationResponseSchema),
        401: errorResponse('Missing or invalid access token.'),
        409: errorResponse('The slug is already taken. Slugs are globally unique.'),
        422: errorResponse('Validation failed.'),
      },
    },
  },
};
