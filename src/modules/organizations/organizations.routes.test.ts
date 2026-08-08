import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import request from 'supertest';

import { app, asIdentity, asUser, db, json, resetDatabase, seed } from '@/test/support';
import type { ErrorResponse } from '@/test/support';

import { createOrganizationsService } from './organizations.service';

interface OrganizationResponse {
  id: string;
  name: string;
  slug: string;
  role?: string;
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

describe('POST /api/v1/organizations', () => {
  it('creates the organization, an owner membership and a default project', async () => {
    const res = await request(app)
      .post('/api/v1/organizations')
      .set(asIdentity(fixtures.ada))
      .send({ name: 'Initech', slug: 'initech' });

    expect(res.status).toBe(201);
    const created = json<OrganizationResponse>(res);
    expect(created).toMatchObject({ name: 'Initech', slug: 'initech' });

    // The other two writes are the point of the transaction, so assert them
    // rather than trusting the 201.
    const membership = await db.membership.findUnique({
      where: { userId_organizationId: { userId: fixtures.ada.id, organizationId: created.id } },
    });
    expect(membership?.role).toBe('OWNER');

    const projects = await db.project.findMany({ where: { organizationId: created.id } });
    expect(projects).toHaveLength(1);
    expect(projects[0]?.name).toBe('General');
  });

  it('succeeds without an x-org-id header', async () => {
    // The reason this route cannot use requireAuth: a caller creating their
    // first organization has no membership to be checked against, so demanding
    // the header would make the endpoint impossible to reach.
    const res = await request(app)
      .post('/api/v1/organizations')
      .set(asIdentity(fixtures.ada))
      .send({ name: 'Hooli', slug: 'hooli' });

    expect(res.status).toBe(201);
  });

  it('makes the creator an owner regardless of what the request asks for', async () => {
    const res = await request(app)
      .post('/api/v1/organizations')
      .set(asIdentity(fixtures.bob))
      .send({ name: 'Umbrella', slug: 'umbrella', role: 'MEMBER' });

    const created = json<OrganizationResponse>(res);
    const membership = await db.membership.findUnique({
      where: { userId_organizationId: { userId: fixtures.bob.id, organizationId: created.id } },
    });

    expect(membership?.role).toBe('OWNER');
  });

  it('returns 409 for a slug already taken', async () => {
    const res = await request(app)
      .post('/api/v1/organizations')
      .set(asIdentity(fixtures.ada))
      .send({ name: 'Acme again', slug: 'acme' });

    expect(res.status).toBe(409);
    expect(json<ErrorResponse>(res).error.code).toBe('CONFLICT');

    // Two from the seed, and nothing from the rejected attempt.
    expect(await db.organization.count()).toBe(2);
  });

  it('rejects a slug that is not url-safe', async () => {
    const res = await request(app)
      .post('/api/v1/organizations')
      .set(asIdentity(fixtures.ada))
      .send({ name: 'Initech', slug: 'Not A Slug' });

    expect(res.status).toBe(400);
    expect(json<ErrorResponse>(res).error.details).toEqual([
      { path: 'body.slug', message: 'Lowercase letters, numbers and single hyphens only' },
    ]);
  });

  it('requires a bearer token', async () => {
    const res = await request(app)
      .post('/api/v1/organizations')
      .send({ name: 'Anonymous', slug: 'anonymous' });

    expect(res.status).toBe(401);
  });
});

describe('organization creation atomicity', () => {
  it('leaves no organization behind when a later write fails', async () => {
    const organizations = createOrganizationsService(db);
    const before = await db.organization.count();

    // Forced through a user id that does not exist, so the membership insert
    // fails on its foreign key after the organization row has already been
    // written. Without the transaction that row would survive — and being
    // reachable only through a membership, nothing in the API could ever see
    // or delete it. See docs/adr/0012.
    let error: unknown;
    try {
      await organizations.create('00000000-0000-7000-8000-000000000000', {
        name: 'Rolled back',
        slug: 'rolled-back',
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toHaveProperty('code', 'P2003');
    expect(await db.organization.count()).toBe(before);
    expect(await db.organization.findUnique({ where: { slug: 'rolled-back' } })).toBeNull();
  });
});

describe('GET /api/v1/organizations', () => {
  it('returns only the organizations the caller belongs to, with their role', async () => {
    const res = await request(app).get('/api/v1/organizations').set(asIdentity(fixtures.ada));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(json<OrganizationResponse[]>(res)[0]).toMatchObject({
      id: fixtures.acme.id,
      slug: 'acme',
      role: 'OWNER',
    });
  });

  it('includes an organization the moment it is created', async () => {
    await request(app)
      .post('/api/v1/organizations')
      .set(asIdentity(fixtures.ada))
      .send({ name: 'Initech', slug: 'initech' });

    const res = await request(app).get('/api/v1/organizations').set(asIdentity(fixtures.ada));

    expect(
      json<OrganizationResponse[]>(res)
        .map((o) => o.slug)
        .sort(),
    ).toEqual(['acme', 'initech']);
  });
});

describe('a created organization is immediately usable', () => {
  it('accepts a task in the default project through the normal auth path', async () => {
    const created = json<OrganizationResponse>(
      await request(app)
        .post('/api/v1/organizations')
        .set(asIdentity(fixtures.ada))
        .send({ name: 'Initech', slug: 'initech' }),
    );

    const projects = json<{ id: string }[]>(
      await request(app).get('/api/v1/projects').set(asUser(fixtures.ada, created.id)),
    );

    const res = await request(app)
      .post('/api/v1/tasks')
      .set(asUser(fixtures.ada, created.id))
      .send({ projectId: projects[0]?.id, title: 'First task' });

    // The end the default project exists for: registration through to a first
    // task with no step that requires a project the caller was never given.
    expect(res.status).toBe(201);
  });
});
