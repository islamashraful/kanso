import type { RequestHandler } from 'express';

import { UnauthorizedError } from '@/lib/errors';

import type {
  AttachmentParams,
  ConfirmAttachmentInput,
  PresignAttachmentInput,
} from './attachments.schema';
import type { AttachmentsService } from './attachments.service';

/**
 * Controllers unwrap the request, call one service method, and shape the
 * response. Same shape as `tasks.controller.ts`.
 */
export const createAttachmentsController = (attachments: AttachmentsService) => {
  // `requireAuth` runs before every route here, so `req.auth` is always set.
  const auth = (req: Parameters<RequestHandler>[0]) => {
    if (!req.auth) throw new UnauthorizedError();
    return req.auth;
  };

  const list: RequestHandler = async (req, res) => {
    const { taskId } = req.validated?.params as AttachmentParams;
    res.json(await attachments.list(auth(req).organizationId, taskId));
  };

  const presign: RequestHandler = async (req, res) => {
    const { taskId } = req.validated?.params as AttachmentParams;
    const input = req.validated?.body as PresignAttachmentInput;
    res.status(201).json(await attachments.presign(auth(req).organizationId, taskId, input));
  };

  const confirm: RequestHandler = async (req, res) => {
    const { taskId } = req.validated?.params as AttachmentParams;
    const input = req.validated?.body as ConfirmAttachmentInput;
    res
      .status(201)
      .json(await attachments.confirm(auth(req).organizationId, taskId, auth(req).userId, input));
  };

  return { list, presign, confirm };
};
