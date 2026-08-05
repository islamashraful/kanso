# Kanso

A multi-tenant task and project management API.

**Kanso** (簡素) is the Japanese design principle of simplicity through elimination.

> Early development. This README will grow into the real thing: architecture
> diagram, ER diagram, auth flow, local setup, demo credentials, and links to
> the live deployment and API reference.

## Stack

Bun, Express 5, TypeScript, PostgreSQL, Prisma, Redis. Deployed on AWS
(ECS Fargate, RDS, S3) behind an ALB with HTTPS.

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — how the system is structured and why
- [`docs/adr/`](docs/adr/) — architecture decision records

## License

MIT
