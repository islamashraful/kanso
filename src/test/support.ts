import type { Role } from '@/generated/prisma/enums';
import type { TaskAssignedJobData } from '@/jobs/notifications.job';

import { createApp } from '@/app';
import { config } from '@/config';
import { createDb } from '@/lib/db';
import { createTokens } from '@/lib/tokens';

/**
 * Shared fixtures for the integration suite.
 *
 * One database client and one app, built the same way `server.ts` builds them,
 * so tests exercise the real composition root rather than a rearrangement of
 * it. See docs/adr/0009.
 */
export const db = createDb(config);

/**
 * A fake in place of the real BullMQ-backed queue, so the suite never
 * touches Redis for ordinary assignment tests. This is the one dependency
 * deliberately faked rather than run for real — see docs/adr/0016 for why,
 * and `src/jobs/notifications.worker.test.ts` for the real-Redis proof that
 * the wiring itself works.
 */
export const notifications = {
  calls: [] as TaskAssignedJobData[],
  enqueueTaskAssigned(data: TaskAssignedJobData) {
    notifications.calls.push(data);
    return Promise.resolve();
  },
};

/**
 * A fake in place of the real Redis client, for the same reason as
 * `notifications` above: the ordinary suite asserts against the app's
 * behavior, not Redis's. `health.readiness.test.ts` is the deliberate
 * exception that pings a real connection, mirroring
 * `notifications.worker.test.ts`.
 */
export const redis = {
  ping: () => Promise.resolve('PONG'),
};

/**
 * A fake in place of the real Redis-backed cache. Real get/set/del semantics
 * over an in-memory `Map`, not stubbed responses — the tests in
 * `tasks.routes.test.ts` that assert caching and invalidation actually
 * behave rely on this holding a value across calls the way Redis would.
 * `lib/cache.test.ts` is the deliberate real-Redis exception, mirroring
 * `notifications.worker.test.ts`.
 */
export const cache = {
  store: new Map<string, string>(),
  get(key: string) {
    return Promise.resolve(this.store.get(key) ?? null);
  },
  set(key: string, value: string) {
    this.store.set(key, value);
    return Promise.resolve();
  },
  del(key: string) {
    this.store.delete(key);
    return Promise.resolve();
  },
};

/**
 * A fake in place of the real S3-backed `ObjectStore`, for the same reason
 * as `cache` above: the ordinary suite asserts against the app's behavior,
 * not a real bucket. `lib/s3.test.ts` is the deliberate real-MinIO
 * exception, mirroring `lib/cache.test.ts`. See docs/adr/0018.
 *
 * `createPresignedPost` deliberately does not place anything in `uploads` —
 * a real presigned POST does not touch the bucket either, only a later
 * upload against the returned URL does. Tests that need `confirm` to
 * succeed call `simulateUpload` first, standing in for that direct
 * client-to-bucket request.
 */
export const objectStore = {
  uploads: new Map<string, { contentType: string; size: number }>(),
  createPresignedPost(params: { key: string; contentType: string }) {
    return Promise.resolve({
      url: 'https://fake-bucket.test/upload',
      fields: { key: params.key, 'Content-Type': params.contentType },
    });
  },
  headObject(key: string) {
    return Promise.resolve(objectStore.uploads.get(key) ?? null);
  },
};

export const simulateUpload = (
  key: string,
  object: { contentType: string; size: number },
): void => {
  objectStore.uploads.set(key, object);
};

export const app = createApp({ config, db, notifications, redis, cache, objectStore });

const tokens = createTokens(config);

export interface SeededUser {
  id: string;
  email: string;
  name: string;
  accessToken: string;
}

/**
 * Two organizations with a member each and a project each, so cross-tenant
 * access is testable: every "can org A read org B's data" case needs something
 * of B's to fail to reach.
 */
export const seed = async () => {
  const [acme, globex] = await Promise.all([
    db.organization.create({ data: { name: 'Acme', slug: 'acme' } }),
    db.organization.create({ data: { name: 'Globex', slug: 'globex' } }),
  ]);

  const [adaRow, bobRow] = await Promise.all([
    db.user.create({ data: { email: 'ada@test.local', name: 'Ada', passwordHash: 'x' } }),
    db.user.create({ data: { email: 'bob@test.local', name: 'Bob', passwordHash: 'x' } }),
  ]);

  await db.membership.createMany({
    data: [
      { userId: adaRow.id, organizationId: acme.id, role: 'OWNER' },
      { userId: bobRow.id, organizationId: globex.id, role: 'MEMBER' },
    ],
  });

  const [acmeProject, globexProject] = await Promise.all([
    db.project.create({ data: { organizationId: acme.id, name: 'Acme project' } }),
    db.project.create({ data: { organizationId: globex.id, name: 'Globex project' } }),
  ]);

  // Tokens are minted here rather than in each test so `asUser` can stay
  // synchronous at its several dozen call sites.
  const [ada, bob] = await Promise.all([withToken(adaRow), withToken(bobRow)]);

  return { acme, globex, ada, bob, acmeProject, globexProject };
};

/**
 * An extra member of an existing organization, for the role cases. Kept out of
 * `seed` so the fixture counts the other suites assert on stay put.
 */
export const addMember = async (
  organizationId: string,
  role: Role,
  email = `member-${role.toLowerCase()}@test.local`,
): Promise<SeededUser> => {
  const user = await db.user.create({
    data: { email, name: `A ${role.toLowerCase()}`, passwordHash: 'x' },
  });

  await db.membership.create({ data: { userId: user.id, organizationId, role } });

  return withToken(user);
};

const withToken = async (user: {
  id: string;
  email: string;
  name: string;
}): Promise<SeededUser> => ({
  id: user.id,
  email: user.email,
  name: user.name,
  accessToken: await tokens.signAccessToken(user.id),
});

/**
 * Credentials for a request: a signed access token proving identity, and the
 * organization the caller claims to be acting in. The second is verified
 * against a membership row on every request, never trusted. See docs/adr/0011.
 */
export const asUser = (user: SeededUser, organizationId: string) => ({
  authorization: `Bearer ${user.accessToken}`,
  'x-org-id': organizationId,
});

/**
 * Identity alone, with no organization named. For the routes guarded by
 * `requireUser`, where the caller may not belong to one yet.
 */
export const asIdentity = (user: SeededUser) => ({
  authorization: `Bearer ${user.accessToken}`,
});

/**
 * Organizations cascade to memberships, projects and tasks; users cascade to
 * memberships and refresh tokens. Deleting both leaves an empty database.
 */
export const resetDatabase = async () => {
  await db.organization.deleteMany();
  await db.user.deleteMany();
  notifications.calls = [];
  cache.store.clear();
  objectStore.uploads.clear();
};

/** The envelope every paginated collection returns. See docs/adr/0014. */
export interface PageResponse<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrevious: boolean;
  };
}

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: { path: string; message: string }[];
  };
}

/**
 * Supertest types `res.body` as `any`. Naming the expected shape keeps the
 * strict lint rules on and doubles as a written record of the API contract.
 */
export const json = <T>(res: { body: unknown }): T => res.body as T;
