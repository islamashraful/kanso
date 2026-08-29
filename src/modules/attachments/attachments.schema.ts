import { z } from 'zod';

import type { AttachmentModel as Attachment } from '@/generated/prisma/models';
import { MAX_ATTACHMENT_SIZE_BYTES } from '@/lib/s3';
import type { Serialized } from '@/lib/serialized';

/**
 * The request contract for attachments. Single source of truth: these
 * schemas drive runtime validation, the TypeScript types below via z.infer,
 * and the OpenAPI document. See docs/adr/0005, docs/adr/0015 and
 * docs/adr/0018.
 */

/**
 * Deliberately closed rather than "anything the client sends": an
 * open-ended content-type would also open-end what `<img>`/`<iframe>`
 * embeds of an attachment's presigned URL can render in a browser.
 */
export const ALLOWED_ATTACHMENT_CONTENT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
] as const;

export const attachmentParamsSchema = z.object({
  taskId: z.uuid('Not a valid task id'),
});

export const presignAttachmentSchema = z.object({
  fileName: z.string().trim().min(1, 'File name is required').max(255),
  contentType: z.enum(ALLOWED_ATTACHMENT_CONTENT_TYPES),
});

/**
 * `key` is opaque to the client: it is whatever `POST .../presign` returned
 * and is never constructed by hand. `fileName` is asked for again rather
 * than parsed back out of the key, since the key exists to be a safe,
 * collision-free storage path, not a record of the original name.
 */
export const confirmAttachmentSchema = z.object({
  key: z.string().min(1),
  fileName: z.string().trim().min(1, 'File name is required').max(255),
});

/** What a presigned upload looks like on the wire: everything the client
 * needs to POST the file straight to the bucket. */
export const presignedPostResponseSchema = z
  .object({
    key: z.string(),
    url: z.url(),
    fields: z.record(z.string(), z.string()),
  })
  .meta({ id: 'PresignedPost' });

export const attachmentResponseSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    taskId: z.uuid(),
    key: z.string(),
    fileName: z.string(),
    contentType: z.string(),
    size: z.int(),
    uploadedById: z.uuid(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'Attachment' });

export type AttachmentParams = z.infer<typeof attachmentParamsSchema>;
export type PresignAttachmentInput = z.infer<typeof presignAttachmentSchema>;
export type ConfirmAttachmentInput = z.infer<typeof confirmAttachmentSchema>;
export type PresignedPostResponse = z.infer<typeof presignedPostResponseSchema>;
export type AttachmentResponse = z.infer<typeof attachmentResponseSchema>;

export { MAX_ATTACHMENT_SIZE_BYTES };

/*
 * Pins the documented response to the Prisma model. Neither line runs: each
 * is an assignability assertion written as a function, and together they
 * fail `bun run typecheck` if the two shapes differ in either direction. See
 * lib/serialized.ts for the full reasoning.
 */
const _matchesModel = (attachment: Serialized<Attachment>): AttachmentResponse => attachment;
const _matchesSchema = (attachment: AttachmentResponse): Serialized<Attachment> => attachment;
void _matchesModel;
void _matchesSchema;
