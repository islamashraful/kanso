import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost as buildPresignedPost } from '@aws-sdk/s3-presigned-post';

import type { Config } from '@/config';

export interface PresignedUpload {
  url: string;
  fields: Record<string, string>;
}

export interface UploadedObject {
  size: number;
  contentType: string;
}

/**
 * The narrow shape a consumer actually needs, rather than a raw `S3Client`.
 * Same reasoning as `Cache` (docs/adr/0017) and `NotificationsQueue`
 * (docs/adr/0016): depend on the operations used, so a test can fake them
 * without a bucket. See docs/adr/0018.
 */
export interface ObjectStore {
  /**
   * A presigned POST policy scoped to exactly one key, with the caps this
   * codebase enforces (size, content-type) as S3-side conditions — not
   * server-side validation of bytes it never sees, since the upload itself
   * goes straight from the client to the bucket.
   */
  createPresignedPost(params: { key: string; contentType: string }): Promise<PresignedUpload>;

  /**
   * Confirms an object exists and reports what the bucket actually has for
   * it, rather than trusting the client's claim. Returns null on a miss:
   * `NotFound` is an expected outcome here (an unconfirmed or fabricated
   * upload), not a failure to surface as a 500.
   */
  headObject(key: string): Promise<UploadedObject | null>;
}

export const createS3Client = (config: Config): S3Client =>
  new S3Client({
    region: config.S3_REGION,
    endpoint: config.S3_ENDPOINT,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: config.S3_ACCESS_KEY_ID,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY,
    },
  });

/**
 * Short-lived on purpose: a presigned POST is a bearer credential for one
 * upload. The narrower the window, the less a leaked URL (a browser history
 * entry, a proxy log) is worth to whoever finds it.
 */
const PRESIGNED_POST_EXPIRY_SECONDS = 60;

/** Caps every attachment upload, enforced by S3 itself via the policy's
 * `content-length-range` condition — not by this codebase inspecting bytes
 * it never receives. See docs/adr/0018. */
export const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024;

/**
 * Backs `ObjectStore` with a real S3 (or S3-compatible, e.g. MinIO)
 * connection.
 */
export const createS3ObjectStore = (client: S3Client, bucket: string): ObjectStore => ({
  async createPresignedPost({ key, contentType }) {
    const { url, fields } = await buildPresignedPost(client, {
      Bucket: bucket,
      Key: key,
      Conditions: [
        ['content-length-range', 1, MAX_ATTACHMENT_SIZE_BYTES],
        ['eq', '$Content-Type', contentType],
      ],
      Fields: { 'Content-Type': contentType },
      Expires: PRESIGNED_POST_EXPIRY_SECONDS,
    });

    return { url, fields };
  },

  async headObject(key) {
    try {
      const result = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return { size: result.ContentLength ?? 0, contentType: result.ContentType ?? '' };
    } catch (err) {
      if (err instanceof Error && err.name === 'NotFound') return null;
      throw err;
    }
  },
});
