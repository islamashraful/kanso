import { describe, expect, test } from 'bun:test';
import request from 'supertest';

import { app, json } from '@/test/support';

import { routeTable } from './route-table';

/**
 * What is worth testing about generated documentation.
 *
 * Not that a description reads well — that changes with every edit and pins
 * nothing. What matters is the properties the generation is relied on for: the
 * document parses as OpenAPI 3.1, every route the app serves appears in it,
 * and the security model it describes matches the one the middleware actually
 * enforces. A reference that quietly omits an endpoint, or documents an open
 * endpoint as authenticated, is worse than no reference. See docs/adr/0015.
 */

interface Operation {
  security?: unknown[];
  parameters?: { name: string; in: string; required?: boolean }[];
  responses: Record<string, unknown>;
}

interface Spec {
  openapi: string;
  info: { title: string };
  security: Record<string, unknown>[];
  components: {
    securitySchemes: Record<string, { type: string; scheme: string }>;
    schemas: Record<string, unknown>;
  };
  paths: Record<string, Record<string, Operation>>;
}

const spec = async (): Promise<Spec> => json<Spec>(await request(app).get('/openapi.json'));

const documentedOperations = (doc: Spec) =>
  Object.entries(doc.paths).flatMap(([path, methods]) =>
    Object.keys(methods).map((method) => `${method.toUpperCase()} ${path}`),
  );

/**
 * Routes that serve the documentation rather than the API. They cannot appear
 * in the document describing them, so they are named here — explicitly, rather
 * than filtered by a pattern that might also hide a real endpoint.
 *
 * They are fed to the route table as known paths too: prefixes are discovered
 * from paths known to route, and nothing else reaches the router these are
 * mounted on. `/reference` is absent because Scalar is mounted with `use` and
 * so is middleware rather than a route.
 */
const INFRASTRUCTURE_PATHS = ['/openapi.json'];
const INFRASTRUCTURE_OPERATIONS = ['GET /openapi.json'];

describe('GET /openapi.json', () => {
  test('serves an OpenAPI 3.1 document without credentials', async () => {
    // No auth headers: the spec describes the shape of the API, not any
    // tenant's data, and a reference nobody can open documents nothing.
    const res = await request(app).get('/openapi.json');

    expect(res.status).toBe(200);
    expect(json<Spec>(res).openapi).toBe('3.1.0');
    expect(json<Spec>(res).info.title).toBe('Kanso API');
  });

  test('documents exactly the routes the app serves', async () => {
    const doc = await spec();
    const documented = documentedOperations(doc);

    // The app's own route table, read from Express, rather than a list typed
    // into this file. Comparing the document to a hand-written list would only
    // catch documentation being changed — an endpoint added to the router and
    // never documented would leave both sides at their old value and pass.
    const { routes, unresolved } = routeTable(app, [
      ...Object.keys(doc.paths),
      ...INFRASTRUCTURE_PATHS,
    ]);

    // A router no known path reaches is a module mounted and never documented.
    expect(unresolved).toEqual([]);

    const served = routes.filter((route) => !INFRASTRUCTURE_OPERATIONS.includes(route));

    expect(served.toSorted()).toEqual(documented.toSorted());
  });

  test('lists the API surface it is expected to have', async () => {
    // The other direction: the test above proves the two agree, this one
    // proves they agree on the right thing. Without it, deleting an endpoint
    // and its documentation together would pass.
    expect(documentedOperations(await spec()).toSorted()).toEqual([
      'DELETE /api/v1/projects/{id}',
      'GET /api/v1/organizations',
      'GET /api/v1/projects',
      'GET /api/v1/projects/{id}',
      'GET /api/v1/tasks',
      'GET /api/v1/tasks/{id}',
      'POST /api/v1/auth/login',
      'POST /api/v1/auth/logout',
      'POST /api/v1/auth/refresh',
      'POST /api/v1/auth/register',
      'POST /api/v1/organizations',
      'POST /api/v1/projects',
      'POST /api/v1/tasks',
      'POST /api/v1/tasks/{id}/assign',
    ]);
  });

  test('requires a bearer token by default and exempts only the auth routes', async () => {
    const doc = await spec();

    expect(doc.security).toEqual([{ bearerAuth: [] }]);
    expect(doc.components.securitySchemes.bearerAuth).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });

    // `security: []` is the override that makes a path public. Exactly the
    // four auth routes carry it, because they are how a token is obtained.
    const open = Object.entries(doc.paths).flatMap(([path, methods]) =>
      Object.entries(methods)
        .filter(([, op]) => op.security?.length === 0)
        .map(([method]) => `${method.toUpperCase()} ${path}`),
    );

    expect(open.toSorted()).toEqual([
      'POST /api/v1/auth/login',
      'POST /api/v1/auth/logout',
      'POST /api/v1/auth/refresh',
      'POST /api/v1/auth/register',
    ]);
  });

  test('documents x-org-id on the scoped routes and not on the others', async () => {
    const doc = await spec();

    const takesOrgHeader = (op: Operation) =>
      op.parameters?.some((p) => p.name === 'x-org-id' && p.in === 'header') ?? false;

    const scoped = Object.entries(doc.paths).flatMap(([path, methods]) =>
      Object.entries(methods)
        .filter(([, op]) => takesOrgHeader(op))
        .map(([method]) => `${method.toUpperCase()} ${path}`),
    );

    // Tasks and projects only. Auth has no organization yet, and the two
    // organization routes run before the caller has one. See docs/adr/0012.
    expect(scoped.toSorted()).toEqual([
      'DELETE /api/v1/projects/{id}',
      'GET /api/v1/projects',
      'GET /api/v1/projects/{id}',
      'GET /api/v1/tasks',
      'GET /api/v1/tasks/{id}',
      'POST /api/v1/projects',
      'POST /api/v1/tasks',
      'POST /api/v1/tasks/{id}/assign',
    ]);
  });

  test('derives query parameters from the same schema that validates them', async () => {
    const listTasks = (await spec()).paths['/api/v1/tasks']?.get;
    const limit = listTasks?.parameters?.find((p) => p.name === 'limit');

    // The cap is the reason this matters: documentation that promised an
    // uncapped limit would be describing a request the API rejects. `required`
    // is absent rather than false, which is how OpenAPI spells optional.
    expect(limit?.required).toBeUndefined();
    expect(limit).toMatchObject({
      in: 'query',
      schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
    });
  });

  test('names the shared components rather than inlining them', async () => {
    const schemas = (await spec()).components.schemas;

    expect(Object.keys(schemas).toSorted()).toEqual([
      'AuthResponse',
      'AuthUser',
      'Error',
      'Organization',
      'OrganizationMembership',
      'PageMeta',
      'Project',
      'ProjectPage',
      'Task',
      'TaskPage',
      'TokenPair',
    ]);
  });
});

describe('GET /reference', () => {
  test('serves the Scalar page pointed at the spec', async () => {
    const res = await request(app).get('/reference');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('/openapi.json');
  });
});
