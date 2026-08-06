import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import request from 'supertest';

import { createApp } from '@/app';
import { config } from '@/config';
import { createDb } from '@/lib/db';

const db = createDb(config);
const app = createApp({ config, db });

/** Two organizations, so cross-tenant access can actually be tested. */
const seed = async () => {
  const [acme, globex] = await Promise.all([
    db.organization.create({ data: { name: 'Acme', slug: 'acme' } }),
    db.organization.create({ data: { name: 'Globex', slug: 'globex' } }),
  ]);
  const [ada, bob] = await Promise.all([
    db.user.create({ data: { email: 'ada@test.local', name: 'Ada', passwordHash: 'x' } }),
    db.user.create({ data: { email: 'bob@test.local', name: 'Bob', passwordHash: 'x' } }),
  ]);
  await db.membership.createMany({
    data: [
      { userId: ada.id, organizationId: acme.id, role: 'OWNER' },
      { userId: bob.id, organizationId: globex.id, role: 'MEMBER' },
    ],
  });
  return { acme, globex, ada, bob };
};

/**
 * Supertest types `res.body` as `any`. Naming the expected shape keeps the
 * strict lint rules on and doubles as a written record of the API contract.
 */
interface TaskResponse {
  id: string;
  title: string;
  status: string;
  organizationId: string;
}

interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: { path: string; message: string }[];
  };
}

const json = <T>(res: { body: unknown }): T => res.body as T;

const asUser = (userId: string, organizationId: string) => ({
  'x-user-id': userId,
  'x-org-id': organizationId,
});

let fixtures: Awaited<ReturnType<typeof seed>>;

beforeEach(async () => {
  // Organizations cascade to memberships and tasks; users cascade to
  // memberships. Deleting both leaves an empty database.
  await db.organization.deleteMany();
  await db.user.deleteMany();
  fixtures = await seed();
});

afterAll(async () => {
  await db.organization.deleteMany();
  await db.user.deleteMany();
  await db.$disconnect();
});

describe('POST /api/v1/tasks', () => {
  it('creates a task in the caller organization', async () => {
    const res = await request(app)
      .post('/api/v1/tasks')
      .set(asUser(fixtures.ada.id, fixtures.acme.id))
      .send({ title: 'Write the vertical slice' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      title: 'Write the vertical slice',
      status: 'OPEN',
      organizationId: fixtures.acme.id,
    });
  });

  it('rejects a missing title with a field-level message', async () => {
    const res = await request(app)
      .post('/api/v1/tasks')
      .set(asUser(fixtures.ada.id, fixtures.acme.id))
      .send({ title: '   ' });

    expect(res.status).toBe(400);
    expect(json<ErrorResponse>(res).error.code).toBe('VALIDATION_ERROR');
    expect(json<ErrorResponse>(res).error.details).toEqual([
      { path: 'body.title', message: 'Title is required' },
    ]);
  });

  it('ignores an organizationId supplied by the client', async () => {
    const res = await request(app)
      .post('/api/v1/tasks')
      .set(asUser(fixtures.ada.id, fixtures.acme.id))
      .send({ title: 'Sneaky', organizationId: fixtures.globex.id });

    expect(res.status).toBe(201);
    expect(json<TaskResponse>(res).organizationId).toBe(fixtures.acme.id);
  });
});

describe('GET /api/v1/tasks', () => {
  it('returns only the caller organization tasks', async () => {
    await db.task.createMany({
      data: [
        { organizationId: fixtures.acme.id, title: 'Acme task' },
        { organizationId: fixtures.globex.id, title: 'Globex task' },
      ],
    });

    const res = await request(app)
      .get('/api/v1/tasks')
      .set(asUser(fixtures.ada.id, fixtures.acme.id));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(json<TaskResponse[]>(res)[0]?.title).toBe('Acme task');
  });

  it('filters by status', async () => {
    await db.task.createMany({
      data: [
        { organizationId: fixtures.acme.id, title: 'Open one' },
        { organizationId: fixtures.acme.id, title: 'Done one', status: 'DONE' },
      ],
    });

    const res = await request(app)
      .get('/api/v1/tasks?status=DONE')
      .set(asUser(fixtures.ada.id, fixtures.acme.id));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(json<TaskResponse[]>(res)[0]?.title).toBe('Done one');
  });
});

describe('GET /api/v1/tasks/:id', () => {
  it('returns a task belonging to the caller organization', async () => {
    const task = await db.task.create({
      data: { organizationId: fixtures.acme.id, title: 'Acme task' },
    });

    const res = await request(app)
      .get(`/api/v1/tasks/${task.id}`)
      .set(asUser(fixtures.ada.id, fixtures.acme.id));

    expect(res.status).toBe(200);
    expect(json<TaskResponse>(res).id).toBe(task.id);
  });

  it('returns 404, not 403, for a task in another organization', async () => {
    const globexTask = await db.task.create({
      data: { organizationId: fixtures.globex.id, title: 'Globex task' },
    });

    const res = await request(app)
      .get(`/api/v1/tasks/${globexTask.id}`)
      .set(asUser(fixtures.ada.id, fixtures.acme.id));

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
    const res = await request(app)
      .get('/api/v1/tasks')
      .set(asUser(fixtures.bob.id, fixtures.acme.id));

    expect(res.status).toBe(403);
    expect(json<ErrorResponse>(res).error.code).toBe('FORBIDDEN');
  });
});
