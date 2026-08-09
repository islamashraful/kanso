import type { ZodOpenApiPathsObject } from 'zod-openapi';

import {
  errorResponse,
  jsonResponse,
  orgHeaderSchema,
  pagedSchema,
  scopedFailures,
} from '@/openapi/components';

import {
  createProjectSchema,
  listProjectsSchema,
  projectParamsSchema,
  projectResponseSchema,
} from './projects.schema';

/** Documents the project routes. See docs/adr/0015. */
export const projectPaths: ZodOpenApiPathsObject = {
  '/api/v1/projects': {
    get: {
      tags: ['Projects'],
      summary: 'List projects in the organization',
      requestParams: { query: listProjectsSchema, header: orgHeaderSchema },
      responses: {
        200: jsonResponse(
          'One page of projects.',
          pagedSchema('ProjectPage', projectResponseSchema),
        ),
        ...scopedFailures,
      },
    },
    post: {
      tags: ['Projects'],
      summary: 'Create a project',
      requestParams: { header: orgHeaderSchema },
      requestBody: { content: { 'application/json': { schema: createProjectSchema } } },
      responses: {
        201: jsonResponse('The created project.', projectResponseSchema),
        ...scopedFailures,
      },
    },
  },

  '/api/v1/projects/{id}': {
    get: {
      tags: ['Projects'],
      summary: 'Read one project',
      requestParams: { path: projectParamsSchema, header: orgHeaderSchema },
      responses: {
        200: jsonResponse('The project.', projectResponseSchema),
        ...scopedFailures,
        404: errorResponse('No such project, or it belongs to another organization.'),
      },
    },
    delete: {
      tags: ['Projects'],
      summary: 'Delete a project and its tasks',
      description:
        'Requires the `ADMIN` role or higher. Deleting a project cascades to its tasks. See docs/adr/0013.',
      requestParams: { path: projectParamsSchema, header: orgHeaderSchema },
      responses: {
        204: { description: 'Deleted. Returns nothing.' },
        ...scopedFailures,
        403: errorResponse(
          'The caller is a member but ranks below `ADMIN`. A 403 rather than a 404 because membership is already proved, so the project is not a secret from them.',
        ),
        404: errorResponse('No such project, or it belongs to another organization.'),
      },
    },
  },
};
