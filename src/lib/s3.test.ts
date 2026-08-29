import { describe, expect, it } from 'bun:test';

import { config } from '@/config';
import { createS3Client, createS3ObjectStore } from '@/lib/s3';

/**
 * This test talks to real MinIO, proving `createPresignedPost` and
 * `headObject` actually round-trip through the S3 POST Policy API rather
 * than only asserting against the in-memory fake in `test/support.ts`. Same
 * deliberate exception as `lib/cache.test.ts` — see docs/adr/0016 and
 * docs/adr/0018.
 *
 * MinIO implements the same POST Policy API real S3 does, so this proves
 * the presigned-post code path end to end — including the actual HTTP POST
 * a browser client would make — without needing an AWS account.
 */
describe('S3 object store against real MinIO', () => {
  it('accepts an upload that satisfies the presigned policy, and reports it back via headObject', async () => {
    const client = createS3Client(config);
    const objectStore = createS3ObjectStore(client, config.S3_BUCKET);
    const key = `s3-test/${crypto.randomUUID()}.txt`;

    expect(await objectStore.headObject(key)).toBeNull();

    const { url, fields } = await objectStore.createPresignedPost({
      key,
      contentType: 'text/plain',
    });

    const body = new FormData();
    for (const [name, value] of Object.entries(fields)) body.append(name, value);
    body.append('file', new Blob(['hello from a real upload'], { type: 'text/plain' }));

    const uploadRes = await fetch(url, { method: 'POST', body });
    expect(uploadRes.ok).toBe(true);

    const uploaded = await objectStore.headObject(key);
    expect(uploaded).toEqual({ size: 24, contentType: 'text/plain' });
  });

  it('rejects an upload whose content-type violates the presigned policy', async () => {
    const client = createS3Client(config);
    const objectStore = createS3ObjectStore(client, config.S3_BUCKET);
    const key = `s3-test/${crypto.randomUUID()}.txt`;

    const { url, fields } = await objectStore.createPresignedPost({
      key,
      contentType: 'text/plain',
    });

    const body = new FormData();
    for (const [name, value] of Object.entries(fields)) {
      // The policy signed 'text/plain'; sending anything else must be
      // rejected by the bucket itself, not merely by this codebase's own
      // validation, since the upload never passes through the app.
      body.append(name, name === 'Content-Type' ? 'application/json' : value);
    }
    body.append('file', new Blob(['{}'], { type: 'application/json' }));

    const uploadRes = await fetch(url, { method: 'POST', body });
    expect(uploadRes.ok).toBe(false);
    expect(await objectStore.headObject(key)).toBeNull();
  });
});
