import { Router, type RequestHandler } from 'express';

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
 * Auth is applied by the parent router that mounts this one, which is what
 * lets `presignLimiter` key on `req.auth.userId`. See docs/adr/0018 and
 * docs/adr/0020.
 */
export const createAttachmentsRouter = (
  attachments: AttachmentsService,
  presignLimiter: RequestHandler,
): Router => {
  const controller = createAttachmentsController(attachments);
  const router = Router({ mergeParams: true });

  router.get('/', validate({ params: attachmentParamsSchema }), controller.list);
  router.post(
    '/presign',
    validate({ params: attachmentParamsSchema, body: presignAttachmentSchema }),
    presignLimiter,
    controller.presign,
  );
  router.post(
    '/',
    validate({ params: attachmentParamsSchema, body: confirmAttachmentSchema }),
    controller.confirm,
  );

  return router;
};
