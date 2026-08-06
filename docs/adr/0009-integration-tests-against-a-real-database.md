# 9. Test against a real database, in a separate one from development

Date: 2026-08-06
Status: Accepted

## Context

The multi-tenant isolation guarantees in
[ADR-7](0007-multi-tenant-with-org-scoped-queries.md) are only as good as their
enforcement, so they have to be tested. The question is what the tests run
against.

A mocked Prisma client makes tests fast and removes the Docker dependency, but
it cannot verify the thing that matters. Asserting that the service called
`findFirst` with an `organizationId` proves the code passed an argument to a
fake; it says nothing about whether Postgres filtered the rows, whether the
unique constraint held, or whether a cascade removed what it should. Those are
database behaviours, and a substitute for the database cannot demonstrate them.

Running against a real database raises a second question: which one. Tests
clear the tables before every case so they start from a known state, which
makes pointing them at the development database destructive.

## Decision

Integration tests run against real PostgreSQL, driving `createApp()` through
Supertest across the full request cycle.

They use a **separate database**, `kanso_test`, on the same Compose-managed
server. `bun test` sets `NODE_ENV=test`, which makes Bun load `.env.test` over
`.env` and repoint `DATABASE_URL`. No test code is aware of this, and it cannot
be forgotten at the call site.

`kanso_test` is created by an init script mounted into the Postgres container,
so it exists after `docker compose up` rather than being a setup step passed on
by word of mouth.

Unit tests are reserved for logic with branching worth isolating.

## Consequences

The isolation tests are meaningful. "A user from one organization gets 404 for
another organization's task" is verified by Postgres returning no rows, not by a
mock returning what the test told it to.

Constraints and cascades are covered for free, because they are exercised by the
same tests rather than needing their own.

The suite needs Docker running and is slower than mocked tests. At this size the
difference is not worth optimising; if it becomes one, the answer is
transaction-per-test rollback rather than reintroducing mocks.

Migrations now apply to two databases, so `db:migrate` is followed by
`db:migrate:test`. Forgetting produces a test failure against a schema one
migration behind, which is confusing the first time it happens.

`.env.test` is untracked like every other environment file, so
`.env.test.example` exists to stop a fresh clone from silently falling back to
`.env` and wiping the development database.
