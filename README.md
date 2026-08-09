# Kanso

A multi-tenant task and project management API.

**Kanso** (簡素) is the Japanese design principle of simplicity through elimination.

> Early development. This README will grow into the real thing: architecture
> diagram, ER diagram, auth flow, demo credentials, and links to the live
> deployment and API reference.

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

- [`docs/adr/`](docs/adr/) — architecture decision records: what was decided, and why
- [`docs/writing.md`](docs/writing.md) — documentation conventions

## License

MIT
