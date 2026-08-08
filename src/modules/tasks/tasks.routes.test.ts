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
  // One project per organization: tasks require one, and having a project in
  // the other tenant is what makes the cross-organization cases testable.
  const [acmeProject, globexProject] = await Promise.all([
    db.project.create({ data: { organizationId: acme.id, name: 'Acme project' } }),
    db.project.create({ data: { organizationId: globex.id, name: 'Globex project' } }),
  ]);
  return { acme, globex, ada, bob, acmeProject, globexProject };
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
  projectId: string;
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
  // Organizations cascade to memberships, projects and tasks; users cascade to
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
      .set(asUser(fixtures.ada.id, fixtures.acme.id))
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
      .set(asUser(fixtures.ada.id, fixtures.acme.id))
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
      .set(asUser(fixtures.ada.id, fixtures.acme.id))
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
      .set(asUser(fixtures.ada.id, fixtures.acme.id));

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
      .set(asUser(fixtures.ada.id, fixtures.acme.id));

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
      .set(asUser(fixtures.ada.id, fixtures.acme.id));

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
