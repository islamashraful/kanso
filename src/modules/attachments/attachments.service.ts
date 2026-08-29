import type { AttachmentModel as Attachment } from '@/generated/prisma/models';
import type { Db } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';
import type { ObjectStore } from '@/lib/s3';

import type { ConfirmAttachmentInput, PresignAttachmentInput } from './attachments.schema';

/** Collapses anything that is not alphanumeric, a dot, or a dash into a
 * single dash, so a filename can never inject an extra path segment (`../`)
 * or an S3-meaningful character into the key. */
const sanitizeFileName = (fileName: string): string => fileName.replace(/[^a-zA-Z0-9.-]+/g, '-');

/**
 * The key an object is stored and confirmed under. Generated server-side —
 * never accepted from the client — so multi-tenant scoping is a property of
 * the key itself, not a check layered on top of a client-supplied one. See
 * docs/adr/0018.
 */
const buildKey = (organizationId: string, taskId: string, fileName: string): string =>
  `orgs/${organizationId}/tasks/${taskId}/${crypto.randomUUID()}-${sanitizeFileName(fileName)}`;

/**
 * Attachment business logic.
 *
 * Same shape as the other services: `organizationId` first on every method,
 * every query filters on it. `objectStore` arrives as an argument rather
 * than an import, so tests can substitute it without touching a real
 * bucket. See docs/adr/0001, docs/adr/0003 and docs/adr/0018.
 */
export const createAttachmentsService = (db: Db, objectStore: ObjectStore) => ({
  async list(organizationId: string, taskId: string): Promise<Attachment[]> {
    const task = await db.task.findFirst({
      where: { id: taskId, organizationId },
      select: { id: true },
    });
    if (!task) throw new NotFoundError('Task not found');

    return db.attachment.findMany({
      where: { organizationId, taskId },
      orderBy: { createdAt: 'desc' },
    });
  },

  /**
   * Builds a presigned POST scoped to a server-generated key, so the
   * caller never chooses where in the bucket its upload lands. The bucket
   * enforces the size and content-type conditions on the upload itself;
   * this method never sees the file's bytes.
   */
  async presign(
    organizationId: string,
    taskId: string,
    input: PresignAttachmentInput,
  ): Promise<{ key: string; url: string; fields: Record<string, string> }> {
    const task = await db.task.findFirst({
      where: { id: taskId, organizationId },
      select: { id: true },
    });
    if (!task) throw new NotFoundError('Task not found');

    const key = buildKey(organizationId, taskId, input.fileName);
    const { url, fields } = await objectStore.createPresignedPost({
      key,
      contentType: input.contentType,
    });

    return { key, url, fields };
  },

  /**
   * Records an attachment after the client has uploaded it directly to the
   * bucket. A presigned POST has no server-side callback, so this is the
   * step that turns "a client claims it uploaded something" into "the
   * bucket confirms an object exists" — `size` and `contentType` are read
   * back from `headObject`, not trusted from the request. See docs/adr/0018.
   *
   * An upsert, not a plain create: a presigned link can't be revoked after
   * one use, so `confirm` may legitimately run more than once for the same
   * key. The upsert makes that safe — each call just re-syncs the row to
   * match the bucket, instead of crashing on the second call. See
   * docs/adr/0018.
   */
  async confirm(
    organizationId: string,
    taskId: string,
    uploadedById: string,
    input: ConfirmAttachmentInput,
  ): Promise<Attachment> {
    const task = await db.task.findFirst({
      where: { id: taskId, organizationId },
      select: { id: true },
    });
    if (!task) throw new NotFoundError('Task not found');

    // The key is server-generated at presign time and always carries this
    // prefix. A key that does not is not a forgotten edge case to validate
    // against — it is a caller trying to confirm an object outside this
    // task/organization, which must fail exactly like a nonexistent one.
    const prefix = `orgs/${organizationId}/tasks/${taskId}/`;
    if (!input.key.startsWith(prefix)) throw new NotFoundError('Uploaded object not found');

    const uploaded = await objectStore.headObject(input.key);
    if (!uploaded) throw new NotFoundError('Uploaded object not found');

    return db.attachment.upsert({
      where: { key: input.key },
      create: {
        organizationId,
        taskId,
        key: input.key,
        fileName: input.fileName,
        contentType: uploaded.contentType,
        size: uploaded.size,
        uploadedById,
      },
      update: {
        fileName: input.fileName,
        contentType: uploaded.contentType,
        size: uploaded.size,
        uploadedById,
      },
    });
  },
});

export type AttachmentsService = ReturnType<typeof createAttachmentsService>;
