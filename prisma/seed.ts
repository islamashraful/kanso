import { config } from '@/config';
import { createDb } from '@/lib/db';

/**
 * Demo data for a fresh checkout.
 *
 * A clone with an empty database can start the server but not see it do
 * anything: every endpoint needs a user, an organization and a membership
 * that only registration creates. This writes a realistic set so `bun run
 * dev` is immediately explorable.
 *
 * Idempotent by construction. The seeded organizations and users are removed
 * by slug and email first, and organizations cascade to their memberships,
 * projects and tasks (docs/adr/0010), so running it twice leaves the same
 * database rather than a duplicate or a unique violation.
 */

const PASSWORD = 'correct-horse-battery-staple';

const ORG_SLUGS = ['acme', 'globex'];

const USERS = [
  { email: 'ada@kanso.local', name: 'Ada Lovelace' },
  { email: 'bob@kanso.local', name: 'Bob Ross' },
  { email: 'cara@kanso.local', name: 'Cara Diaz' },
  { email: 'dan@kanso.local', name: 'Dan Kim' },
];

const seed = async () => {
  // The seed deletes before it writes, so it must never reach a real
  // database. Config has already validated NODE_ENV at boot.
  if (config.NODE_ENV === 'production') {
    throw new Error('Refusing to seed a production database');
  }

  const db = createDb(config);

  try {
    await db.organization.deleteMany({ where: { slug: { in: ORG_SLUGS } } });
    await db.user.deleteMany({ where: { email: { in: USERS.map((u) => u.email) } } });

    // One hash reused across the demo users. Argon2id is deliberately slow
    // (docs/adr/0011), and hashing the same password four times would cost
    // four times as much to prove nothing.
    const passwordHash = await Bun.password.hash(PASSWORD);

    const [ada, bob, cara, dan] = await db.user.createManyAndReturn({
      data: USERS.map((user) => ({ ...user, passwordHash })),
    });

    if (!ada || !bob || !cara || !dan) throw new Error('Seed users were not created');

    // Acme carries all three roles, so the RBAC middleware has something to
    // refuse: Cara is a plain member and cannot delete a project
    // (docs/adr/0013). Globex exists so tenant isolation is visible — Dan's
    // data must be unreachable with Acme credentials.
    const acme = await db.organization.create({
      data: {
        name: 'Acme',
        slug: 'acme',
        memberships: {
          create: [
            { userId: ada.id, role: 'OWNER' },
            { userId: bob.id, role: 'ADMIN' },
            { userId: cara.id, role: 'MEMBER' },
          ],
        },
        projects: {
          create: [{ name: 'Platform' }, { name: 'Website' }],
        },
      },
      include: { projects: true },
    });

    const globex = await db.organization.create({
      data: {
        name: 'Globex',
        slug: 'globex',
        memberships: { create: [{ userId: dan.id, role: 'OWNER' }] },
        projects: { create: [{ name: 'Research' }] },
      },
      include: { projects: true },
    });

    const [platform, website] = acme.projects;
    const [research] = globex.projects;

    if (!platform || !website || !research) throw new Error('Seed projects were not created');

    // Every status represented, and tasks spread across two projects, so the
    // list filters (?status=, ?projectId=) return something other than
    // everything.
    await db.task.createMany({
      data: [
        { organizationId: acme.id, projectId: platform.id, title: 'Add pagination to /tasks' },
        {
          organizationId: acme.id,
          projectId: platform.id,
          title: 'Generate OpenAPI from the Zod schemas',
          status: 'IN_PROGRESS',
        },
        {
          organizationId: acme.id,
          projectId: platform.id,
          title: 'Enforce organization roles',
          status: 'DONE',
        },
        { organizationId: acme.id, projectId: website.id, title: 'Write the landing copy' },
        {
          organizationId: acme.id,
          projectId: website.id,
          title: 'Pick a font',
          status: 'DONE',
        },
        {
          organizationId: globex.id,
          projectId: research.id,
          title: 'Nobody at Acme can read this',
        },
      ],
    });

    console.log(`Seeded ${USERS.length} users, 2 organizations, 3 projects, 6 tasks.`);
    console.log(`\nSign in as any of these with the password: ${PASSWORD}\n`);
    console.log(`  ada@kanso.local    OWNER  of Acme    x-org-id: ${acme.id}`);
    console.log(`  bob@kanso.local    ADMIN  of Acme    x-org-id: ${acme.id}`);
    console.log(`  cara@kanso.local   MEMBER of Acme    x-org-id: ${acme.id}`);
    console.log(`  dan@kanso.local    OWNER  of Globex  x-org-id: ${globex.id}`);
  } finally {
    await db.$disconnect();
  }
};

await seed();
