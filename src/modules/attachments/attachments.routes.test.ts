import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import request from 'supertest';

import {
  app,
  asUser,
  db,
  json,
  objectStore,
  resetDatabase,
  seed,
  simulateUpload,
} from '@/test/support';
import type { ErrorResponse } from '@/test/support';

interface AttachmentResponse {
  id: string;
  organizationId: string;
  taskId: string;
  key: string;
  fileName: string;
  contentType: string;
  size: number;
}

interface PresignResponse {
  key: string;
  url: string;
  fields: Record<string, string>;
}

let fixtures: Awaited<ReturnType<typeof seed>>;

beforeEach(async () => {
  await resetDatabase();
  fixtures = await seed();
});

afterAll(async () => {
  await resetDatabase();
  await db.$disconnect();
});

const createTask = (organizationId: string, projectId: string, title = 'Attach something') =>
  db.task.create({ data: { organizationId, projectId, title } });

describe('POST /api/v1/tasks/:taskId/attachments/presign', () => {
  it('returns a presigned post scoped to the task and organization', async () => {
    const task = await createTask(fixtures.acme.id, fixtures.acmeProject.id);

    const res = await request(app)
      .post(`/api/v1/tasks/${task.id}/attachments/presign`)
      .set(asUser(fixtures.ada, fixtures.acme.id))
      .send({ fileName: 'design.png', contentType: 'image/png' });

    expect(res.status).toBe(201);
    const body = json<PresignResponse>(res);
    expect(body.key).toStartWith(`orgs/${fixtures.acme.id}/tasks/${task.id}/`);
    expect(body.key).toEndWith('-design.png');
    expect(body.url).toBeString();
    expect(body.fields['Content-Type']).toBe('image/png');

    // The bucket is untouched until the client actually uploads — a
    // presigned POST is only a credential to do so, not the upload itself.
    expect(objectStore.uploads.has(body.key)).toBe(false);
  });

  it('rejects a content-type outside the allowlist', async () => {
    const task = await createTask(fixtures.acme.id, fixtures.acmeProject.id);

    const res = await request(app)
      .post(`/api/v1/tasks/${task.id}/attachments/presign`)
      .set(asUser(fixtures.ada, fixtures.acme.id))
      .send({ fileName: 'script.sh', contentType: 'application/x-sh' });

    expect(res.status).toBe(400);
    expect(json<ErrorResponse>(res).error.code).toBe('VALIDATION_ERROR');
  });

  it('refuses a task belonging to another organization', async () => {
    const task = await createTask(fixtures.globex.id, fixtures.globexProject.id);

    const res = await request(app)
      .post(`/api/v1/tasks/${task.id}/attachments/presign`)
      .set(asUser(fixtures.ada, fixtures.acme.id))
      .send({ fileName: 'design.png', contentType: 'image/png' });

    // 404 rather than 403, same reasoning as every other cross-tenant read:
    // a distinguishable response would confirm the other org's task exists.
    expect(res.status).toBe(404);
    expect(json<ErrorResponse>(res).error.code).toBe('NOT_FOUND');
  });
});

describe('POST /api/v1/tasks/:taskId/attachments', () => {
  it('records the attachment once the bucket confirms the upload', async () => {
    const task = await createTask(fixtures.acme.id, fixtures.acmeProject.id);

    const presign = await request(app)
      .post(`/api/v1/tasks/${task.id}/attachments/presign`)
      .set(asUser(fixtures.ada, fixtures.acme.id))
      .send({ fileName: 'design.png', contentType: 'image/png' });
    const { key } = json<PresignResponse>(presign);

    // Stands in for the client's direct POST to the bucket, which this
    // suite never performs for real — see docs/adr/0018 and lib/s3.test.ts
    // for the exception that proves the real upload path against MinIO.
    simulateUpload(key, { contentType: 'image/png', size: 2048 });

    const res = await request(app)
      .post(`/api/v1/tasks/${task.id}/attachments`)
      .set(asUser(fixtures.ada, fixtures.acme.id))
      .send({ key, fileName: 'design.png' });

    expect(res.status).toBe(201);
    expect(json<AttachmentResponse>(res)).toMatchObject({
      organizationId: fixtures.acme.id,
      taskId: task.id,
      key,
      fileName: 'design.png',
      contentType: 'image/png',
      size: 2048,
    });
    expect(await db.attachment.count()).toBe(1);
  });

  it('reports size and content-type as the bucket has them, not as the client claims them', async () => {
    const task = await createTask(fixtures.acme.id, fixtures.acmeProject.id);
    const key = `orgs/${fixtures.acme.id}/tasks/${task.id}/real-upload.png`;
    simulateUpload(key, { contentType: 'image/png', size: 999 });

    const res = await request(app)
      .post(`/api/v1/tasks/${task.id}/attachments`)
      .set(asUser(fixtures.ada, fixtures.acme.id))
      // The client's own claim about the file, which the confirmed row
      // must not simply echo back.
      .send({ key, fileName: 'renamed.png' });

    expect(res.status).toBe(201);
    expect(json<AttachmentResponse>(res)).toMatchObject({ contentType: 'image/png', size: 999 });
  });

  it('re-confirming the same key syncs the row instead of crashing on the unique key', async () => {
    const task = await createTask(fixtures.acme.id, fixtures.acmeProject.id);
    const key = `orgs/${fixtures.acme.id}/tasks/${task.id}/reused-link.png`;

    simulateUpload(key, { contentType: 'image/png', size: 100 });
    const first = await request(app)
      .post(`/api/v1/tasks/${task.id}/attachments`)
      .set(asUser(fixtures.ada, fixtures.acme.id))
      .send({ key, fileName: 'first.png' });
    expect(first.status).toBe(201);

    // Stands in for a second, different file uploaded to the same
    // still-valid presigned link before it expires — a presigned POST
    // cannot be revoked after one use. See docs/adr/0018.
    simulateUpload(key, { contentType: 'image/gif', size: 4096 });
    const second = await request(app)
      .post(`/api/v1/tasks/${task.id}/attachments`)
      .set(asUser(fixtures.ada, fixtures.acme.id))
      .send({ key, fileName: 'second.gif' });

    expect(second.status).toBe(201);
    expect(json<AttachmentResponse>(second)).toMatchObject({
      fileName: 'second.gif',
      contentType: 'image/gif',
      size: 4096,
    });
    // One row, re-synced — not a second row and not a crash.
    expect(await db.attachment.count()).toBe(1);
  });

  it('refuses to confirm a key nothing was ever uploaded to', async () => {
    const task = await createTask(fixtures.acme.id, fixtures.acmeProject.id);
    const key = `orgs/${fixtures.acme.id}/tasks/${task.id}/never-uploaded.png`;

    const res = await request(app)
      .post(`/api/v1/tasks/${task.id}/attachments`)
      .set(asUser(fixtures.ada, fixtures.acme.id))
      .send({ key, fileName: 'never-uploaded.png' });

    expect(res.status).toBe(404);
    expect(json<ErrorResponse>(res).error.code).toBe('NOT_FOUND');
    expect(await db.attachment.count()).toBe(0);
  });

  it('refuses a key that belongs to another organization, even if it was uploaded', async () => {
    const acmeTask = await createTask(fixtures.acme.id, fixtures.acmeProject.id);
    const globexTask = await createTask(fixtures.globex.id, fixtures.globexProject.id);
    const globexKey = `orgs/${fixtures.globex.id}/tasks/${globexTask.id}/secret.png`;
    simulateUpload(globexKey, { contentType: 'image/png', size: 100 });

    const res = await request(app)
      .post(`/api/v1/tasks/${acmeTask.id}/attachments`)
      .set(asUser(fixtures.ada, fixtures.acme.id))
      .send({ key: globexKey, fileName: 'secret.png' });

    expect(res.status).toBe(404);
    expect(await db.attachment.count()).toBe(0);
  });
});

describe('GET /api/v1/tasks/:taskId/attachments', () => {
  it('returns only the caller organization attachments for the task', async () => {
    const acmeTask = await createTask(fixtures.acme.id, fixtures.acmeProject.id);
    const globexTask = await createTask(fixtures.globex.id, fixtures.globexProject.id);

    await db.attachment.create({
      data: {
        organizationId: fixtures.acme.id,
        taskId: acmeTask.id,
        key: `orgs/${fixtures.acme.id}/tasks/${acmeTask.id}/a.png`,
        fileName: 'a.png',
        contentType: 'image/png',
        size: 10,
        uploadedById: fixtures.ada.id,
      },
    });
    await db.attachment.create({
      data: {
        organizationId: fixtures.globex.id,
        taskId: globexTask.id,
        key: `orgs/${fixtures.globex.id}/tasks/${globexTask.id}/b.png`,
        fileName: 'b.png',
        contentType: 'image/png',
        size: 10,
        uploadedById: fixtures.bob.id,
      },
    });

    const res = await request(app)
      .get(`/api/v1/tasks/${acmeTask.id}/attachments`)
      .set(asUser(fixtures.ada, fixtures.acme.id));

    expect(res.status).toBe(200);
    const body = json<AttachmentResponse[]>(res);
    expect(body).toHaveLength(1);
    expect(body[0]?.fileName).toBe('a.png');
  });

  it('refuses a task belonging to another organization', async () => {
    const globexTask = await createTask(fixtures.globex.id, fixtures.globexProject.id);

    const res = await request(app)
      .get(`/api/v1/tasks/${globexTask.id}/attachments`)
      .set(asUser(fixtures.ada, fixtures.acme.id));

    expect(res.status).toBe(404);
  });
});
