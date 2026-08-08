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
export const app = createApp({ config, db });

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
};

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
