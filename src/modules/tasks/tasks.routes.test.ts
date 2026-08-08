import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { SignJWT } from 'jose';
import request from 'supertest';

import { config } from '@/config';
import { app, asUser, db, json, resetDatabase, seed } from '@/test/support';
import type { ErrorResponse } from '@/test/support';

interface TaskResponse {
  id: string;
  title: string;
  status: string;
  organizationId: string;
  projectId: string;
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

describe('POST /api/v1/tasks', () => {
  it('creates a task in the caller organization', async () => {
    const res = await request(app)
      .post('/api/v1/tasks')
      .set(asUser(fixtures.ada, fixtures.acme.id))
      .send({ title: 'Write the vertical slice', projectId: fixtures.acmeProject.id });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      title: 'Write the vertical slice',
      status: 'OPEN',
      organizationId: fixtures.acme.id,
      projectId: fixtures.acmeProject.id,
    });
  });

  it('rejects a missing title with a field-level message', async () => {
    const res = await request(app)
      .post('/api/v1/tasks')
      .set(asUser(fixtures.ada, fixtures.acme.id))
      .send({ title: '   ', projectId: fixtures.acmeProject.id });

    expect(res.status).toBe(400);
    expect(json<ErrorResponse>(res).error.code).toBe('VALIDATION_ERROR');
    expect(json<ErrorResponse>(res).error.details).toEqual([
      { path: 'body.title', message: 'Title is required' },
    ]);
  });

  it('ignores an organizationId supplied by the client', async () => {
    const res = await request(app)
      .post('/api/v1/tasks')
      .set(asUser(fixtures.ada, fixtures.acme.id))
      .send({
        title: 'Sneaky',
        projectId: fixtures.acmeProject.id,
        organizationId: fixtures.globex.id,
      });

    expect(res.status).toBe(201);
    expect(json<TaskResponse>(res).organizationId).toBe(fixtures.acme.id);
  });

  it('refuses a project belonging to another organization', async () => {
    const res = await request(app)
      .post('/api/v1/tasks')
      .set(asUser(fixtures.ada, fixtures.acme.id))
      .send({ title: 'Cross-tenant', projectId: fixtures.globexProject.id });

    // 404 rather than 403, for the same reason as reading one: a distinguishable
    // response would confirm the other organization's project exists. The
    // composite foreign key would reject the write regardless — this is what
    // turns that rejection into an answer rather than a 500. See docs/adr/0010.
    expect(res.status).toBe(404);
    expect(json<ErrorResponse>(res).error.code).toBe('NOT_FOUND');
    expect(await db.task.count()).toBe(0);
  });
});

describe('GET /api/v1/tasks', () => {
  it('returns only the caller organization tasks', async () => {
    await db.task.createMany({
      data: [
        {
          organizationId: fixtures.acme.id,
          projectId: fixtures.acmeProject.id,
          title: 'Acme task',
        },
        {
          organizationId: fixtures.globex.id,
          projectId: fixtures.globexProject.id,
          title: 'Globex task',
        },
      ],
    });

    const res = await request(app).get('/api/v1/tasks').set(asUser(fixtures.ada, fixtures.acme.id));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(json<TaskResponse[]>(res)[0]?.title).toBe('Acme task');
  });

  it('filters by status', async () => {
    await db.task.createMany({
      data: [
        { organizationId: fixtures.acme.id, projectId: fixtures.acmeProject.id, title: 'Open one' },
        {
          organizationId: fixtures.acme.id,
          projectId: fixtures.acmeProject.id,
          title: 'Done one',
          status: 'DONE',
        },
      ],
    });

    const res = await request(app)
      .get('/api/v1/tasks?status=DONE')
      .set(asUser(fixtures.ada, fixtures.acme.id));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(json<TaskResponse[]>(res)[0]?.title).toBe('Done one');
  });

  it('filters by project', async () => {
    const other = await db.project.create({
      data: { organizationId: fixtures.acme.id, name: 'Second project' },
    });
    await db.task.createMany({
      data: [
        { organizationId: fixtures.acme.id, projectId: fixtures.acmeProject.id, title: 'First' },
        { organizationId: fixtures.acme.id, projectId: other.id, title: 'Second' },
      ],
    });

    const res = await request(app)
      .get(`/api/v1/tasks?projectId=${other.id}`)
      .set(asUser(fixtures.ada, fixtures.acme.id));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(json<TaskResponse[]>(res)[0]?.title).toBe('Second');
  });
});

describe('GET /api/v1/tasks/:id', () => {
  it('returns a task belonging to the caller organization', async () => {
    const task = await db.task.create({
      data: {
        organizationId: fixtures.acme.id,
        projectId: fixtures.acmeProject.id,
        title: 'Acme task',
      },
    });

    const res = await request(app)
      .get(`/api/v1/tasks/${task.id}`)
      .set(asUser(fixtures.ada, fixtures.acme.id));

    expect(res.status).toBe(200);
    expect(json<TaskResponse>(res).id).toBe(task.id);
  });

  it('returns 404, not 403, for a task in another organization', async () => {
    const globexTask = await db.task.create({
      data: {
        organizationId: fixtures.globex.id,
        projectId: fixtures.globexProject.id,
        title: 'Globex task',
      },
    });

    const res = await request(app)
      .get(`/api/v1/tasks/${globexTask.id}`)
      .set(asUser(fixtures.ada, fixtures.acme.id));

    // 404 rather than 403 on purpose: a distinguishable 403 would confirm the
    // task exists, leaking one tenant's data to another.
    expect(res.status).toBe(404);
    expect(json<ErrorResponse>(res).error.code).toBe('NOT_FOUND');
  });
});

describe('authentication', () => {
  it('rejects a request with no credentials', async () => {
    const res = await request(app).get('/api/v1/tasks');

    expect(res.status).toBe(401);
    expect(json<ErrorResponse>(res).error.code).toBe('UNAUTHORIZED');
  });

  it('rejects a caller who is not a member of the organization', async () => {
    const res = await request(app).get('/api/v1/tasks').set(asUser(fixtures.bob, fixtures.acme.id));

    expect(res.status).toBe(403);
    expect(json<ErrorResponse>(res).error.code).toBe('FORBIDDEN');
  });

  it('rejects a token this server did not sign', async () => {
    // Signed with a valid HS256 key, just not ours. A server that decoded the
    // payload without verifying the signature would accept this and hand the
    // caller whatever user id it names.
    const forged = await new SignJWT()
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(fixtures.ada.id)
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(new TextEncoder().encode('an-attacker-key-that-is-32-chars-long'));

    const res = await request(app)
      .get('/api/v1/tasks')
      .set({ authorization: `Bearer ${forged}`, 'x-org-id': fixtures.acme.id });

    expect(res.status).toBe(401);
    expect(json<ErrorResponse>(res).error.message).toBe('Invalid access token');
  });

  it('reports an expired token distinctly, so a client knows to refresh', async () => {
    const expired = await new SignJWT()
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(fixtures.ada.id)
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(new TextEncoder().encode(config.JWT_SECRET));

    const res = await request(app)
      .get('/api/v1/tasks')
      .set({ authorization: `Bearer ${expired}`, 'x-org-id': fixtures.acme.id });

    expect(res.status).toBe(401);
    expect(json<ErrorResponse>(res).error.message).toBe('Access token expired');
  });

  it('rejects a valid token with no organization named, as a bad request', async () => {
    const res = await request(app)
      .get('/api/v1/tasks')
      .set({ authorization: `Bearer ${fixtures.ada.accessToken}` });

    // 400, not 401: the caller proved who they are and simply did not say
    // which tenant they are acting in. See docs/adr/0011.
    expect(res.status).toBe(400);
    expect(json<ErrorResponse>(res).error.code).toBe('VALIDATION_ERROR');
  });
});
