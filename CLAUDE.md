# Kanso

Multi-tenant task and project management API. Bun + Express 5 + TypeScript +
PostgreSQL + Prisma, deployed to AWS ECS Fargate.

Bun is the runtime, package manager and test runner. There is no `tsc` build
step — Bun runs TypeScript directly. Prisma uses the Rust-free client
(`provider = "prisma-client"`, `engineType = "client"`, `runtime = "bun"`), and
the Prisma CLI runs via `bunx --bun`.

## Conventions

Recorded in full in `docs/architecture.md`, with the reasoning behind each in
`docs/adr/`. The load-bearing ones:

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

## Decisions

New architectural decisions go in `docs/adr/`, written the day the decision is
made rather than reconstructed later.

- **Nygard format only** — Context, Decision, Consequences. One page.
- **Name the rejected alternative.** A record without one is not a decision,
  it is a description. If nothing was seriously considered and set aside, it
  does not need an ADR.
- **State the costs**, not only the benefits. What gets harder, what this
  commits the project to, and anything left unverified.
- **Impersonal voice.** "Use Bun as the runtime", not "we use Bun" or "I chose
  Bun". Decision sections read as imperatives; Context and Consequences are
  plain descriptive prose.
- **Cross-link** related records where the reasoning actually connects.
- **Never edit an accepted record.** Supersede it with a new one and mark the
  old `Superseded by [N]`.
- Update the table in `docs/adr/README.md` when adding one.

## Writing

Applies to every document in this repo, including the README.

- Write for an engineer reading the code, not a user deciding whether to adopt
  it. No adoption pitch, no feature marketing.
- Plain declaratives. Say what is true and stop.
- No superlatives or filler: avoid "seamlessly", "powerful", "robust",
  "simply", "just", "easily", "blazing fast". If a claim is worth making, it
  is worth a number or a reason.
- Don't hedge into vagueness. "Socket.IO support on Bun is not documented" is
  better than "there may be some potential compatibility considerations".
- `docs/architecture.md` says what the system *is*, in present tense. ADRs say
  *why it became that*. Neither restates the other; `architecture.md` links
  out.
- Em dashes are fine.

## Commits

Imperative subject line. The body explains why, not what — the diff already
covers what.

## Verify

```
bun run lint && bun run typecheck && bun test
```
