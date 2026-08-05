# 2. Use Bun as the runtime, package manager and test runner

Date: 2026-08-05
Status: Accepted

## Context

The default choice is Node.js with npm or pnpm, plus a separate test runner
and a TypeScript build step. Bun offers all of it in one binary and runs
TypeScript directly, with no compilation stage.

Node is the safer choice on compatibility grounds: it is what most production
services run, and every library targets it first. Bun is faster across
installs, test runs and startup, and collapses four tools into one.

The relevant risks were checked before deciding rather than assumed:

- Express on Bun is documented and supported.
- Prisma works on Bun, but requires the Rust-free client rather than the
  default (`provider = "prisma-client"`, `engineType = "client"`,
  `runtime = "bun"`).
- Socket.IO server support on Bun is **not** documented either way. Bun's
  own WebSocket story is native `Bun.serve`, which does not compose with an
  Express app.

## Decision

Use Bun as the runtime, package manager and test runner, in development and in
production.

The production image builds on `oven/bun:1` with no compile stage.

The Socket.IO question is deliberately left open rather than assumed. It is
resolved separately once real-time work begins, and the fallbacks are the `ws`
package with a thin event layer, or running the WebSocket process on Node.

## Consequences

No build step anywhere: no `tsc`, no `dist/`, and a simpler Dockerfile than
the Node equivalent. Tests need no runner dependency, since `bun test` is
built in and Jest-compatible ([ADR-8](0008-bun-test-as-test-runner.md)).

Prisma requires the non-default client configuration above. Getting this wrong
produces confusing failures, so it is recorded in the project conventions
rather than left to be rediscovered.

Compatibility risk sits with libraries that reach into Node internals.
Socket.IO is the known open question; anything else surfacing later is
mitigated by the fact that the application code is ordinary Express and
ordinary TypeScript, with nothing Bun-specific in the domain layer. Moving to
Node would mean changing the Dockerfile, the test runner and the Prisma
generator config, not rewriting the application.
