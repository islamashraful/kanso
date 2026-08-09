# Kanso

A multi-tenant task and project management API.

**Kanso** (簡素) is the Japanese design principle of simplicity through elimination.

> Early development. Nothing is deployed yet, so the API reference runs
> locally at `/reference` rather than anywhere public.
> [`docs/architecture.md`](docs/architecture.md) describes how the system is
> put together.

## Stack

Bun, Express 5, TypeScript, PostgreSQL, Prisma. Deployed on AWS (ECS Fargate,
RDS, S3) behind an ALB with HTTPS.

## Local setup

Requires Bun and Docker.

```bash
cp .env.example .env
cp .env.test.example .env.test   # tests use a separate database

docker compose up -d             # Postgres, and kanso_test alongside it
bun install
bun run db:migrate               # development database
bun run db:migrate:test          # test database
bun run db:seed                  # demo organizations, users and tasks

bun run dev                      # http://localhost:3000
```

The API reference is at `http://localhost:3000/reference`, generated from the
same Zod schemas that validate requests, with the raw document at
`/openapi.json`. Requests can be fired from the page itself, which is what the
seeded ids below are for.

The seed prints four sign-in addresses, their roles and the organization ids
they belong to. Every request needs both a bearer token and an `x-org-id`
header, so those ids are what makes the API explorable without registering an
account first. Re-running the seed replaces its own data rather than
duplicating it, and it refuses to run when `NODE_ENV` is `production`.

Both `.env` files are needed. Without `.env.test`, the test suite falls back to
`.env` and wipes the development database, because every test case clears the
tables before it runs.

New migrations apply to both databases: `bun run db:migrate` followed by
`bun run db:migrate:test`.

## Checks

```bash
bun run typecheck
bun run lint
bun test                         # needs Docker running
```

## Documentation

- `/reference` — the API reference, generated from the request schemas
- [`docs/architecture.md`](docs/architecture.md) — how the system is put together
- [`docs/adr/`](docs/adr/) — architecture decision records: what was decided, and why
- [`docs/writing.md`](docs/writing.md) — documentation conventions

## License

MIT
