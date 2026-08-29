import { z } from 'zod';
import type { ZodOpenApiPathsObject } from 'zod-openapi';

import { errorResponse, jsonResponse, orgHeaderSchema, scopedFailures } from '@/openapi/components';

import {
  attachmentParamsSchema,
  attachmentResponseSchema,
  confirmAttachmentSchema,
  presignAttachmentSchema,
  presignedPostResponseSchema,
} from './attachments.schema';

/**
 * Documents the attachment routes. Kept beside the module it describes, same
 * as every other module. See docs/adr/0004, docs/adr/0015 and docs/adr/0018.
 */
export const attachmentPaths: ZodOpenApiPathsObject = {
  '/api/v1/tasks/{taskId}/attachments': {
    get: {
      tags: ['Attachments'],
      summary: 'List attachments on a task',
      description:
        "Not paginated: bounded by one task's attachments, the same reasoning as `GET /organizations` being bounded by the caller's own memberships.",
      requestParams: { path: attachmentParamsSchema, header: orgHeaderSchema },
      responses: {
        200: jsonResponse(
          "The task's attachments, newest first.",
          z.array(attachmentResponseSchema),
        ),
        ...scopedFailures,
        404: errorResponse('No such task, or it belongs to another organization.'),
      },
    },
    post: {
      tags: ['Attachments'],
      summary: 'Confirm an uploaded attachment',
      description:
        'Records the attachment after the client has uploaded it directly to the bucket using the presigned POST from `POST /attachments/presign`. `size` and `contentType` are read back from the bucket via a HEAD check, not trusted from the request — a presigned POST has no server-side upload callback, so this is what turns "the client says it uploaded something" into a confirmed row. See docs/adr/0018.',
      requestParams: { path: attachmentParamsSchema, header: orgHeaderSchema },
      requestBody: { content: { 'application/json': { schema: confirmAttachmentSchema } } },
      responses: {
        201: jsonResponse('The recorded attachment.', attachmentResponseSchema),
        ...scopedFailures,
        404: errorResponse(
          "No such task, or `key` does not name an object that exists in this task's attachments.",
        ),
      },
    },
  },

  '/api/v1/tasks/{taskId}/attachments/presign': {
    post: {
      tags: ['Attachments'],
      summary: 'Get a presigned POST to upload a task attachment',
      description:
        'The file is never sent to this API: the client POSTs it directly to the bucket using the returned `url` and `fields`. The key is generated server-side and scoped to this task, and the bucket enforces size and content-type as policy conditions on the upload itself. See docs/adr/0018.',
      requestParams: { path: attachmentParamsSchema, header: orgHeaderSchema },
      requestBody: { content: { 'application/json': { schema: presignAttachmentSchema } } },
      responses: {
        201: jsonResponse(
          'The key to confirm the upload under, and the presigned POST to upload with.',
          presignedPostResponseSchema,
        ),
        ...scopedFailures,
        404: errorResponse('No such task, or it belongs to another organization.'),
      },
    },
  },
};
