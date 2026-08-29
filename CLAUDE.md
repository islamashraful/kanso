# Kanso

Multi-tenant task and project management API. Bun + Express 5 + TypeScript +
PostgreSQL + Prisma, deployed to AWS ECS Fargate.

Bun is the runtime, package manager and test runner. There is no `tsc` build
step — Bun runs TypeScript directly. Prisma uses the Rust-free client
(`provider = "prisma-client"`, `engineType = "client"`, `runtime = "bun"`), and
the Prisma CLI runs via `bunx --bun`.

## Conventions

The reasoning behind each is in `docs/adr/`. The load-bearing ones:

- Three-tier layering: router → controller → service → data access.
  **`req` and `res` never leave the controller.** Services take plain
  arguments, return plain data, and throw `AppError` subclasses.
- Dependencies are passed as arguments to factory functions and wired in a
  single composition root (`src/app.ts`). No DI container.
- Folders group by feature (`src/modules/tasks/`), not by technical type.
- `createApp()` builds the app and never calls `listen()`; `server.ts` owns
  the process and graceful shutdown.
- `src/config/` is the only place that reads `process.env`, parsed through Zod
  and failing fast at boot.
- Zod schemas are the single source of truth: validation, `z.infer` types, and
  the OpenAPI spec all derive from them.
- One error middleware, registered last, with all four arguments. Express 5
  forwards rejected promises automatically, so handlers need no `try/catch`.
- Authorization is middleware (`requireAuth`, `requireOrgRole`), never inline
  conditionals.

## Writing docs, ADRs or commit messages

Read `docs/writing.md` first. Architectural decisions go in `docs/adr/`,
written the day the decision is made.

## Verify

Requires `docker compose up -d` (Postgres, Redis and MinIO) — the integration
tests run against real infrastructure, not mocks.

```
bun run lint && bun run typecheck && bun run format:check && bun test
```
