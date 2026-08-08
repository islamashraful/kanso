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
interface ProjectResponse {
  id: string;
  name: string;
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

describe('POST /api/v1/projects', () => {
  it('creates a project in the caller organization', async () => {
    const res = await request(app)
      .post('/api/v1/projects')
      .set(asUser(fixtures.ada.id, fixtures.acme.id))
      .send({ name: 'Platform' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Platform', organizationId: fixtures.acme.id });
  });

  it('rejects a missing name with a field-level message', async () => {
    const res = await request(app)
      .post('/api/v1/projects')
      .set(asUser(fixtures.ada.id, fixtures.acme.id))
      .send({ name: '   ' });

    expect(res.status).toBe(400);
    expect(json<ErrorResponse>(res).error.details).toEqual([
      { path: 'body.name', message: 'Name is required' },
    ]);
  });

  it('ignores an organizationId supplied by the client', async () => {
    const res = await request(app)
      .post('/api/v1/projects')
      .set(asUser(fixtures.ada.id, fixtures.acme.id))
      .send({ name: 'Sneaky', organizationId: fixtures.globex.id });

    expect(res.status).toBe(201);
    expect(json<ProjectResponse>(res).organizationId).toBe(fixtures.acme.id);
  });
});

describe('GET /api/v1/projects', () => {
  it('returns only the caller organization projects', async () => {
    await Promise.all([
      db.project.create({ data: { organizationId: fixtures.acme.id, name: 'Acme project' } }),
      db.project.create({ data: { organizationId: fixtures.globex.id, name: 'Globex project' } }),
    ]);

    const res = await request(app)
      .get('/api/v1/projects')
      .set(asUser(fixtures.ada.id, fixtures.acme.id));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(json<ProjectResponse[]>(res)[0]?.name).toBe('Acme project');
  });
});

describe('GET /api/v1/projects/:id', () => {
  it('returns a project belonging to the caller organization', async () => {
    const project = await db.project.create({
      data: { organizationId: fixtures.acme.id, name: 'Acme project' },
    });

    const res = await request(app)
      .get(`/api/v1/projects/${project.id}`)
      .set(asUser(fixtures.ada.id, fixtures.acme.id));

    expect(res.status).toBe(200);
    expect(json<ProjectResponse>(res).id).toBe(project.id);
  });

  it('returns 404, not 403, for a project in another organization', async () => {
    const globexProject = await db.project.create({
      data: { organizationId: fixtures.globex.id, name: 'Globex project' },
    });

    const res = await request(app)
      .get(`/api/v1/projects/${globexProject.id}`)
      .set(asUser(fixtures.ada.id, fixtures.acme.id));

    expect(res.status).toBe(404);
    expect(json<ErrorResponse>(res).error.code).toBe('NOT_FOUND');
  });
});

describe('project and task tenant consistency', () => {
  it('refuses a task whose organization disagrees with its project', async () => {
    const globexProject = await db.project.create({
      data: { organizationId: fixtures.globex.id, name: 'Globex project' },
    });

    // Straight at the database, bypassing every service and check above. This
    // is the guarantee ADR-10 buys: the composite foreign key, not application
    // discipline, is what makes the denormalized organizationId safe.
    //
    // try/catch rather than `expect().rejects`, which requires a native promise
    // and rejects the PrismaPromise Prisma actually returns.
    let error: unknown;
    try {
      await db.task.create({
        data: {
          organizationId: fixtures.acme.id,
          projectId: globexProject.id,
          title: 'Impossible',
        },
      });
    } catch (caught) {
      error = caught;
    }

    // Naming the constraint matters. A bare "it threw" would pass if the write
    // failed for an unrelated reason, and would keep passing if this foreign
    // key were dropped and something else broke in the same commit. P2003 is
    // Prisma's foreign key violation; the constraint name pins it to this one.
    expect(error).toHaveProperty('code', 'P2003');
    expect(JSON.stringify(error)).toContain('tasks_projectId_organizationId_fkey');
    expect(await db.task.count()).toBe(0);
  });

  it('cascades a project delete to its tasks', async () => {
    const project = await db.project.create({
      data: { organizationId: fixtures.acme.id, name: 'Doomed' },
    });
    await db.task.create({
      data: { organizationId: fixtures.acme.id, projectId: project.id, title: 'Goes with it' },
    });

    await db.project.delete({ where: { id: project.id } });

    expect(await db.task.count()).toBe(0);
  });
});
