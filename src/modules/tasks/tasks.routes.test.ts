import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { SignJWT } from 'jose';
import request from 'supertest';

import { config } from '@/config';
import { app, asUser, db, json, resetDatabase, seed } from '@/test/support';
import type { ErrorResponse, PageResponse } from '@/test/support';

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
    expect(json<PageResponse<TaskResponse>>(res).data).toHaveLength(1);
    expect(json<PageResponse<TaskResponse>>(res).data[0]?.title).toBe('Acme task');

    // The total counts the caller's organization, not the table. A count that
    // ignored the tenant filter would leak how much data another org holds.
    expect(json<PageResponse<TaskResponse>>(res).meta.total).toBe(1);
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
    expect(json<PageResponse<TaskResponse>>(res).data).toHaveLength(1);
    expect(json<PageResponse<TaskResponse>>(res).data[0]?.title).toBe('Done one');
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
    expect(json<PageResponse<TaskResponse>>(res).data).toHaveLength(1);
    expect(json<PageResponse<TaskResponse>>(res).data[0]?.title).toBe('Second');

    // The count is filtered too. Reporting the unfiltered total beside a
    // filtered page is the classic way a paginator lies about how many pages
    // there are.
    expect(json<PageResponse<TaskResponse>>(res).meta.total).toBe(1);
  });
});

describe('GET /api/v1/tasks pagination', () => {
  /** Sequential rather than createMany, so createdAt strictly increases. */
  const createTasks = async (count: number) => {
    for (let i = 1; i <= count; i += 1) {
      await db.task.create({
        data: {
          organizationId: fixtures.acme.id,
          projectId: fixtures.acmeProject.id,
          title: `Task ${String(i).padStart(2, '0')}`,
        },
      });
    }
  };

  it('returns the first page and describes the rest', async () => {
    await createTasks(25);

    const res = await request(app)
      .get('/api/v1/tasks?limit=10')
      .set(asUser(fixtures.ada, fixtures.acme.id));

    expect(res.status).toBe(200);
    expect(json<PageResponse<TaskResponse>>(res).data).toHaveLength(10);
    expect(json<PageResponse<TaskResponse>>(res).meta).toEqual({
      page: 1,
      limit: 10,
      total: 25,
      totalPages: 3,
      hasNext: true,
      hasPrevious: false,
    });
  });

  it('walks to the last page, which is short', async () => {
    await createTasks(25);

    const res = await request(app)
      .get('/api/v1/tasks?page=3&limit=10')
      .set(asUser(fixtures.ada, fixtures.acme.id));

    expect(res.status).toBe(200);
    expect(json<PageResponse<TaskResponse>>(res).data).toHaveLength(5);
    expect(json<PageResponse<TaskResponse>>(res).meta.hasNext).toBe(false);
    expect(json<PageResponse<TaskResponse>>(res).meta.hasPrevious).toBe(true);
  });

  it('returns an empty page past the end rather than an error', async () => {
    await createTasks(3);

    const res = await request(app)
      .get('/api/v1/tasks?page=9')
      .set(asUser(fixtures.ada, fixtures.acme.id));

    // Asking for a page that does not exist is not a failed request: the
    // answer to "what is on page 9" is "nothing", and the meta says why.
    expect(res.status).toBe(200);
    expect(json<PageResponse<TaskResponse>>(res).data).toEqual([]);
    expect(json<PageResponse<TaskResponse>>(res).meta.total).toBe(3);
  });

  it('calls an empty collection one page, not zero', async () => {
    const res = await request(app).get('/api/v1/tasks').set(asUser(fixtures.ada, fixtures.acme.id));

    expect(json<PageResponse<TaskResponse>>(res).meta.totalPages).toBe(1);
    expect(json<PageResponse<TaskResponse>>(res).meta.hasNext).toBe(false);
  });

  it('does not overlap pages when every row ties on the sort key', async () => {
    // Written with one timestamp on purpose: Prisma maps DateTime to
    // timestamp(3), so rows created in the same millisecond tie in production
    // too, and offset pagination over a non-total ordering can put one row on
    // two pages while dropping another.
    //
    // This pins skip/take, not the tiebreaker. Postgres leaves the order of
    // tied rows unspecified rather than adversarial, and in practice returns
    // the same one for two identical queries — so removing the `id` tiebreaker
    // does not fail this test. The tiebreaker is there because the ordering is
    // not guaranteed, not because this case reproduces it. See docs/adr/0014.
    const createdAt = new Date('2026-08-09T12:00:00.000Z');
    await db.task.createMany({
      data: Array.from({ length: 10 }, (_, i) => ({
        organizationId: fixtures.acme.id,
        projectId: fixtures.acmeProject.id,
        title: `Tied ${String(i)}`,
        createdAt,
      })),
    });

    const credentials = asUser(fixtures.ada, fixtures.acme.id);
    const first = await request(app).get('/api/v1/tasks?page=1&limit=4').set(credentials);
    const second = await request(app).get('/api/v1/tasks?page=2&limit=4').set(credentials);

    const ids = [
      ...json<PageResponse<TaskResponse>>(first).data,
      ...json<PageResponse<TaskResponse>>(second).data,
    ].map((task) => task.id);

    expect(new Set(ids).size).toBe(8);
  });

  it('sorts by a named column in the requested direction', async () => {
    await createTasks(3);

    const res = await request(app)
      .get('/api/v1/tasks?sort=title&order=asc')
      .set(asUser(fixtures.ada, fixtures.acme.id));

    expect(json<PageResponse<TaskResponse>>(res).data.map((task) => task.title)).toEqual([
      'Task 01',
      'Task 02',
      'Task 03',
    ]);
  });

  it('refuses a sort key that is not on the list', async () => {
    // The point of the enum: without it this reaches Prisma's orderBy as an
    // arbitrary column name from the query string. See docs/adr/0014.
    const res = await request(app)
      .get('/api/v1/tasks?sort=organizationId')
      .set(asUser(fixtures.ada, fixtures.acme.id));

    expect(res.status).toBe(400);
    expect(json<ErrorResponse>(res).error.code).toBe('VALIDATION_ERROR');
  });

  it('refuses a limit above the cap', async () => {
    // An uncapped limit is the unbounded response pagination exists to
    // remove, one query parameter away.
    const res = await request(app)
      .get('/api/v1/tasks?limit=5000')
      .set(asUser(fixtures.ada, fixtures.acme.id));

    expect(res.status).toBe(400);
    expect(json<ErrorResponse>(res).error.details).toEqual([
      { path: 'query.limit', message: 'Limit cannot exceed 100' },
    ]);
  });

  it('refuses a page below one', async () => {
    const res = await request(app)
      .get('/api/v1/tasks?page=0')
      .set(asUser(fixtures.ada, fixtures.acme.id));

    expect(res.status).toBe(400);
    expect(json<ErrorResponse>(res).error.details).toEqual([
      { path: 'query.page', message: 'Page starts at 1' },
    ]);
  });

  it('refuses a page that is not a number', async () => {
    const res = await request(app)
      .get('/api/v1/tasks?page=two')
      .set(asUser(fixtures.ada, fixtures.acme.id));

    expect(res.status).toBe(400);
    expect(json<ErrorResponse>(res).error.code).toBe('VALIDATION_ERROR');
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
