import { Router } from 'express';

import { validate } from '@/middleware/validate';

import { createAttachmentsController } from './attachments.controller';
import {
  attachmentParamsSchema,
  confirmAttachmentSchema,
  presignAttachmentSchema,
} from './attachments.schema';
import type { AttachmentsService } from './attachments.service';

/**
 * Declares paths, attaches middleware, delegates. No logic.
 *
 * Mounted under `/tasks/:taskId/attachments` with `mergeParams`, so
 * `taskId` from the parent path is visible to `attachmentParamsSchema`.
 * Auth is applied by the parent router that mounts this one.
 */
export const createAttachmentsRouter = (attachments: AttachmentsService): Router => {
  const controller = createAttachmentsController(attachments);
  const router = Router({ mergeParams: true });

  router.get('/', validate({ params: attachmentParamsSchema }), controller.list);
  router.post(
    '/presign',
    validate({ params: attachmentParamsSchema, body: presignAttachmentSchema }),
    controller.presign,
  );
  router.post(
    '/',
    validate({ params: attachmentParamsSchema, body: confirmAttachmentSchema }),
    controller.confirm,
  );

  return router;
};
