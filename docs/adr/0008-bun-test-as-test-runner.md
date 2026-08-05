# 8. Use `bun test` as the test runner

Date: 2026-08-05
Status: Accepted

## Context

The project needs a test runner. The candidates were Jest (the incumbent),
Vitest (faster, better TypeScript defaults), and `bun test`, which is built
into the runtime already chosen in
[ADR-2](0002-bun-as-runtime-and-toolchain.md).

Jest requires a transform to handle TypeScript and is the slowest of the
three. Vitest is a strong standalone choice but adds a dependency and a
configuration file to a project that already has a runner available.

`bun test` implements a Jest-compatible API, runs TypeScript natively, and
needs no configuration.

## Decision

Use `bun test`.

Testing is weighted towards integration rather than unit tests. Tests drive
`createApp()` with Supertest, exercising the full request cycle against a real
Postgres instance from Docker Compose, rather than asserting against mocked
database calls.

Unit tests are reserved for logic with branching worth isolating.

## Consequences

No test dependency, no configuration file, and no transform step. The runner
is the same binary that runs the application.

The Jest-compatible API means the knowledge transfers in both directions, and
migrating to Vitest later would be mostly mechanical if Bun proves limiting.

Integration-first testing is what makes the isolation guarantees in
[ADR-7](0007-multi-tenant-with-org-scoped-queries.md) meaningful: a test that
mocks the database cannot prove a query is correctly scoped. The cost is that
tests need a running database, so the suite is slower than pure unit tests and
depends on Docker Compose being up.

Separating `createApp()` from `server.ts` is what makes this cheap. Each test
file builds its own app instance and hands it to Supertest, which binds an
ephemeral OS-assigned port per request and closes it again. No fixed port to
collide on, no shared server, and no lifecycle for the test to manage.

The ecosystem risk is shared with ADR-2: tooling that assumes Jest or Vitest
internals may not work. Nothing in the test suite depends on runner internals,
which keeps that exposure small.
