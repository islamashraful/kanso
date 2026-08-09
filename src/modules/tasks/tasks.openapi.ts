import type { ZodOpenApiPathsObject } from 'zod-openapi';

import {
  errorResponse,
  jsonResponse,
  orgHeaderSchema,
  pagedSchema,
  scopedFailures,
} from '@/openapi/components';

import {
  createTaskSchema,
  listTasksSchema,
  taskParamsSchema,
  taskResponseSchema,
} from './tasks.schema';

/**
 * Documents the task routes.
 *
 * Kept beside the module it describes rather than in one central spec file, so
 * a route and its documentation move together and a new endpoint is documented
 * in the folder it was added to. See docs/adr/0004 and docs/adr/0015.
 */
export const taskPaths: ZodOpenApiPathsObject = {
  '/api/v1/tasks': {
    get: {
      tags: ['Tasks'],
      summary: 'List tasks in the organization',
      description:
        'Paged by offset behind a `{ data, meta }` envelope. Every ordering ends in `id`, so a row cannot appear on two pages. See docs/adr/0014.',
      requestParams: { query: listTasksSchema, header: orgHeaderSchema },
      responses: {
        200: jsonResponse('One page of tasks.', pagedSchema('TaskPage', taskResponseSchema)),
        ...scopedFailures,
      },
    },
    post: {
      tags: ['Tasks'],
      summary: 'Create a task',
      description:
        'The organization is never accepted from the client: it comes from the verified membership. See docs/adr/0005.',
      requestParams: { header: orgHeaderSchema },
      requestBody: { content: { 'application/json': { schema: createTaskSchema } } },
      responses: {
        201: jsonResponse('The created task.', taskResponseSchema),
        ...scopedFailures,
        404: errorResponse('The project does not exist in this organization.'),
      },
    },
  },

  '/api/v1/tasks/{id}': {
    get: {
      tags: ['Tasks'],
      summary: 'Read one task',
      requestParams: { path: taskParamsSchema, header: orgHeaderSchema },
      responses: {
        200: jsonResponse('The task.', taskResponseSchema),
        ...scopedFailures,
        404: errorResponse(
          'No such task, or it belongs to another organization. The two are deliberately indistinguishable, so ids cannot be probed for what exists. See docs/adr/0007.',
        ),
      },
    },
  },
};
