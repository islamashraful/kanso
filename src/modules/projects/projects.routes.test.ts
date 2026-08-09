import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import request from 'supertest';

import { addMember, app, asUser, db, json, resetDatabase, seed } from '@/test/support';
import type { ErrorResponse } from '@/test/support';

interface ProjectResponse {
  id: string;
  name: string;
  organizationId: string;
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

describe('POST /api/v1/projects', () => {
  it('creates a project in the caller organization', async () => {
    const res = await request(app)
      .post('/api/v1/projects')
      .set(asUser(fixtures.ada, fixtures.acme.id))
      .send({ name: 'Platform' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Platform', organizationId: fixtures.acme.id });
  });

  it('rejects a missing name with a field-level message', async () => {
    const res = await request(app)
      .post('/api/v1/projects')
      .set(asUser(fixtures.ada, fixtures.acme.id))
      .send({ name: '   ' });

    expect(res.status).toBe(400);
    expect(json<ErrorResponse>(res).error.details).toEqual([
      { path: 'body.name', message: 'Name is required' },
    ]);
  });

  it('ignores an organizationId supplied by the client', async () => {
    const res = await request(app)
      .post('/api/v1/projects')
      .set(asUser(fixtures.ada, fixtures.acme.id))
      .send({ name: 'Sneaky', organizationId: fixtures.globex.id });

    expect(res.status).toBe(201);
    expect(json<ProjectResponse>(res).organizationId).toBe(fixtures.acme.id);
  });
});

describe('GET /api/v1/projects', () => {
  it('returns only the caller organization projects', async () => {
    // The seed already gives each organization one project, which is the whole
    // point here: Globex's must not appear.
    const res = await request(app)
      .get('/api/v1/projects')
      .set(asUser(fixtures.ada, fixtures.acme.id));

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
      .set(asUser(fixtures.ada, fixtures.acme.id));

    expect(res.status).toBe(200);
    expect(json<ProjectResponse>(res).id).toBe(project.id);
  });

  it('returns 404, not 403, for a project in another organization', async () => {
    const res = await request(app)
      .get(`/api/v1/projects/${fixtures.globexProject.id}`)
      .set(asUser(fixtures.ada, fixtures.acme.id));

    expect(res.status).toBe(404);
    expect(json<ErrorResponse>(res).error.code).toBe('NOT_FOUND');
  });
});

describe('DELETE /api/v1/projects/:id', () => {
  it('lets an owner delete a project, and takes its tasks with it', async () => {
    const project = await db.project.create({
      data: { organizationId: fixtures.acme.id, name: 'Doomed' },
    });
    await db.task.create({
      data: { organizationId: fixtures.acme.id, projectId: project.id, title: 'Goes too' },
    });

    const res = await request(app)
      .delete(`/api/v1/projects/${project.id}`)
      .set(asUser(fixtures.ada, fixtures.acme.id));

    expect(res.status).toBe(204);
    expect(await db.project.findUnique({ where: { id: project.id } })).toBeNull();
    expect(await db.task.count({ where: { projectId: project.id } })).toBe(0);
  });

  it('lets an admin delete a project', async () => {
    const admin = await addMember(fixtures.acme.id, 'ADMIN');
    const project = await db.project.create({
      data: { organizationId: fixtures.acme.id, name: 'Doomed' },
    });

    const res = await request(app)
      .delete(`/api/v1/projects/${project.id}`)
      .set(asUser(admin, fixtures.acme.id));

    expect(res.status).toBe(204);
  });

  it('refuses a member with 403, and does not delete anything', async () => {
    const member = await addMember(fixtures.acme.id, 'MEMBER');

    const res = await request(app)
      .delete(`/api/v1/projects/${fixtures.acmeProject.id}`)
      .set(asUser(member, fixtures.acme.id));

    expect(res.status).toBe(403);
    expect(json<ErrorResponse>(res).error.code).toBe('FORBIDDEN');

    // The middleware has to run before the handler, not alongside it.
    expect(await db.project.findUnique({ where: { id: fixtures.acmeProject.id } })).not.toBeNull();
  });

  it('reads the role from the organization named in the request, not the user', async () => {
    // Ada owns Acme. That must buy her nothing in Globex, where she is only a
    // member: the role is per organization, not per user.
    await db.membership.create({
      data: { userId: fixtures.ada.id, organizationId: fixtures.globex.id, role: 'MEMBER' },
    });

    const res = await request(app)
      .delete(`/api/v1/projects/${fixtures.globexProject.id}`)
      .set(asUser(fixtures.ada, fixtures.globex.id));

    expect(res.status).toBe(403);
  });

  it('returns 404 for a project in another organization, even to an owner', async () => {
    // 403 above is about role; this is about tenancy. An owner of Acme is
    // authorized, and still must not learn whether Globex's project exists.
    const res = await request(app)
      .delete(`/api/v1/projects/${fixtures.globexProject.id}`)
      .set(asUser(fixtures.ada, fixtures.acme.id));

    expect(res.status).toBe(404);
    expect(
      await db.project.findUnique({ where: { id: fixtures.globexProject.id } }),
    ).not.toBeNull();
  });

  it('requires authentication', async () => {
    const res = await request(app).delete(`/api/v1/projects/${fixtures.acmeProject.id}`);

    expect(res.status).toBe(401);
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
