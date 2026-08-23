# 16. Background jobs with BullMQ, queue as a fakeable dependency

Date: 2026-08-23
Status: Accepted

## Context

Task assignment is the first thing in this codebase that should trigger
work outside the request that caused it: notifying the assignee. Doing that
inline would make `POST /tasks/:id/assign` wait on an email send, and a
failed send would have to decide whether it fails the assignment too. The
standard fix is a queue: the request enqueues a job and returns; a separate
process sends the email.

That raises two decisions, not one.

**Where the job runs.** In-process (`setImmediate`, a fire-and-forget
promise) needs no new infrastructure, but a crash between the response and
the job running loses it, and there is no visibility into failures or
retries. A real queue (BullMQ, backed by Redis) survives a crash and gives
retries and inspection, at the cost of a new piece of infrastructure to run
locally and in CI.

**How the API depends on the queue in tests.** Every other external
dependency in this codebase is tested against the real thing — Postgres,
never mocked ([ADR-9](0009-integration-tests-against-a-real-database.md)).
A queue does not fit that pattern the same way: asserting "a job was
enqueued" against a real BullMQ queue means either running a worker inside
the test (slow, and couples an assignment test to email-sending behavior)
or reading the queue's internal state (coupled to BullMQ's API, not the
application's). The alternative is a narrow interface —
`NotificationsQueue.enqueueTaskAssigned` — that `tasks.service.ts` depends
on, with a fake recording calls in the test suite and a real BullMQ-backed
implementation in `server.ts`. This is exactly the case the project's own
DI section calls out as worth injecting for: a dependency that is painful
to exercise for real in an ordinary test.

## Decision

Run jobs on BullMQ against Redis, in a worker process (`src/worker.ts`)
separate from the API (`src/server.ts`), started with `bun run worker`.

`tasks.service.ts` depends on the `NotificationsQueue` interface
(`src/jobs/notifications.job.ts`), not a BullMQ `Queue` directly. The
integration suite (`src/test/support.ts`) wires a fake implementation that
records calls in memory, so assignment tests never touch Redis.
`src/jobs/notifications.worker.test.ts` is the deliberate exception, and
carries two tests, not one: enqueuing a job directly and confirming a real
worker processes it proves the queue and worker agree with each other, but
it does not prove the real HTTP endpoint agrees with either — a wrong queue
name or job name on either side would still pass that test and the fake
assignment tests, and only fail in production. The second test closes that:
it builds its own `createApp` wired to a real queue, sends a real
`POST /tasks/:id/assign`, and waits for a real worker to process the result,
with only the email send itself faked. Together the two tests are the
project's real-database philosophy applied to this dependency instead of
skipped for it — see [ADR-9](0009-integration-tests-against-a-real-database.md).

A job carries ids (`taskId`, `assigneeId`), not a snapshot of the task or
user. The worker looks both up when it runs, so a title or email changed
between enqueue and processing is never sent stale.

The assignee has to be a member of the task's own organization. That is
enforced the same way `Task.projectId` is
([ADR-10](0010-tasks-carry-organization-and-project.md)): a composite
foreign key, `Task.(assigneeId, organizationId)` referencing
`Membership.(userId, organizationId)`, its own unique constraint. Postgres
rejects an assignment to a non-member outright; `tasks.service.assign`
looks the membership up first only to turn that into a 404 instead of a
500, the same shaping `create` already does for `projectId`.

## Consequences

Local development and CI both need Redis now, alongside Postgres — one more
service in `docker-compose.yml` and one more service container in
`ci.yml`. `REDIS_URL` is required, the same as `DATABASE_URL`, rather than
defaulted: the queue is not optional infrastructure once assignment depends
on it, and a missing setting should fail at boot rather than on the first
request that tries to enqueue a job. That means `.env`, `.env.test` and
`ci.yml`'s `env:` block all need it set, the same as `DATABASE_URL`.

The worker is a second runnable entry point with its own graceful shutdown
(`worker.close()` before the Redis connection quits, mirroring
`server.close()` in `server.ts`). It shares `Db` with the API and nothing
else — no service layer reuse yet, since sending an email is the only job
type and looking up a task and a user directly is simpler than a service
built for one caller.

The composite FK cannot use `onDelete: SetNull` the way a single-column
optional FK would: `organizationId` is required on `Task`, and `SetNull`
would try to null it out too. It uses `Restrict` instead, which is
currently unreachable — there is no membership-removal endpoint yet. When
one is built, it has to clear `assigneeId` on affected tasks before removing
the membership, or the removal will fail against this constraint.

The fake queue means the ordinary test suite proves task assignment writes
the right row and calls the queue with the right arguments, not that a real
job reaches a real worker or that the real endpoint agrees with it.
`notifications.worker.test.ts` is what closes both gaps, and it is the one
file in the suite that requires Redis to be running — its two tests cost a
few extra milliseconds each over the fake, which is cheap for the wiring
guarantee they buy.

The second test in that file — real endpoint, real queue, real worker, one
process — only works because the API and the worker are one codebase, one
CI run, one deploy unit today. That stops being true if the worker is ever
pulled into its own separately-deployed service: at that point the test
would need both services' code loaded into a single process just to run,
which defeats the reason to split them apart. When that split happens:
delete that second test, and replace the guarantee it gave with contract
testing instead — the worker's own suite pins down the exact job shape and
name it expects (promoting `TaskAssignedJobData` from a shared TypeScript
type to a documented, versioned contract each side tests against
independently), and the API's suite verifies it produces exactly that
shape, with neither needing the other's real code running. The first test
in the file (enqueue directly, confirm the worker processes it) stays
regardless, since it only ever exercised the worker's own repository.
