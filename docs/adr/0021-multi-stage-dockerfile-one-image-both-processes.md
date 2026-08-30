# 21. A multi-stage Dockerfile, one image for both processes

Date: 2026-08-30
Status: Accepted

## Context

Closes a gap this plan flagged early and deliberately deferred: `docker
compose up` has always brought up Postgres, Redis and MinIO, never the app
itself, because there was no `Dockerfile` to build it from. That was fine
while the only consumer was the local test suite. It stops being fine once
Week 4 needs an actual image to deploy to ECS, so building and proving that
image now — with CI checking it on every push, the same way `bun test`
already does for the code — is cheaper than discovering a broken build
under Week 4's deployment pressure.

Two questions, not one.

**What goes in the image, and what stays out.** `prisma generate` needs the
Prisma CLI, which is a devDependency — `bun install --frozen-lockfile
--production` skips it on purpose, since nothing at runtime needs a code
generator. A single-stage build would force a choice between carrying the
CLI (and every other dev-only tool) into the image that actually runs, or
generating the client with a separate, easy-to-forget manual step outside
the build.

**One image or two.** `src/server.ts` and `src/worker.ts` are already two
separate entrypoints for two separate processes — the API and the BullMQ
consumer — sharing the same `Deps`-shaped construction. Nothing about
either one is specific to how it's packaged.

## Decision

A three-stage `Dockerfile`. `deps` installs every dependency, including
dev, so `prisma generate` (a `build` stage layered on top of `deps`) has
the CLI available. `runtime`, the stage that actually ships, starts fresh
from `oven/bun:1`, installs only `--production` dependencies, and copies in
just two things from the earlier stages: the generated Prisma client
(`src/generated`, pure JS/TS — Prisma 7's `runtime = "bun"` client has no
native binary to worry about carrying across stages) and the application's
own `src/`. `tsconfig.json` is copied too, deliberately: Bun reads its
`paths` entry to resolve every `@/...` import at runtime, the same as in
dev, so leaving it out would break every import in the image while looking
irrelevant to anyone skimming the `COPY` lines.

One image, not two. `CMD ["bun", "src/server.ts"]` is the default — the
image runs the API unless told otherwise — and the worker is the identical
image with its command overridden at deploy time (`bun src/worker.ts`).
Building two images would duplicate every layer above the one line that
actually differs between them, for a distinction that already exists
cleanly as two files sharing one build.

The image declares its own `HEALTHCHECK`, hitting `GET /health` —
liveness only, the same choice `docs/architecture.md`'s Health checks
section already made for the endpoint itself, and for the same reason:
a database or Redis outage should not make Docker (or later, ECS) decide
the container itself needs killing, when the process is otherwise fine and
would recover the moment the dependency does.

CI gets a second job, `docker`, gated on the existing `verify` job
succeeding first — building an image from code that doesn't even pass its
own tests proves nothing. It builds the image, starts real Postgres and
Redis as service containers (mirroring `verify`'s own setup) plus MinIO via
the same `docker run --network host` pattern the existing MinIO step
already uses, and waits for Docker's own `HEALTHCHECK` to report healthy
before separately curling `/health/ready` — proving the image is not just
buildable but actually runnable, connects to real dependencies, and
answers both endpoints correctly.

## Consequences

**Nothing is pushed anywhere.** The image CI builds is proven, then
discarded when the job ends — there is no registry to push to yet, and
nothing would pull from one. That is exactly the scope this item closes:
prove the packaging is correct and keep it continuously verified, not
deploy. Pushing to a registry (ECR) and actually running from a pulled
image is Week 4's job, once ECS exists to be the consumer.

**No image-size optimization.** `oven/bun:1` rather than an Alpine variant,
because the risk of a native-dependency mismatch (`pg`, `@prisma/adapter-pg`)
under `musl` outweighs the size savings for a stage that only ever exists to
prove correctness in CI. Worth revisiting once a real deployment target
makes image size and pull time an actual cost rather than a number nobody
is paying for yet.

**Migrations are not run from this image.** `prisma/` is not copied into
the `runtime` stage at all — the generated client that's actually imported
at runtime carries no dependency on the schema file or `prisma.config.ts`
once it exists. Applying migrations against a real database is a separate,
explicit step (`prisma migrate deploy`, as `verify` already runs it) rather
than something baked into every container start, the same reasoning ECS
task definitions apply migrations as a one-off task rather than on every
scaled-up replica's boot.
