# 17. Cache task stats in Redis, invalidated explicitly on the writes that change them

Date: 2026-08-28
Status: Accepted

## Context

`GET /tasks/stats` reports task counts by status and the completion rate they
imply for one organization — a `groupBy` across every task in it, unlike the
other task endpoints, which read at most a page or a single row. It is the
first read in this codebase worth caching.

Two decisions, not one.

**How the cache stays correct.** A cache is only worth adding if it can be
trusted not to lie. The easy version — set a TTL and let it expire — trades
correctness for simplicity: for the seconds or minutes before expiry, the
endpoint reports stale counts even though the actual data already changed.
The alternative is to delete the cached entry the moment a write changes
what it describes, so a cache hit is either fresh or absent, never wrong.
That only works if every write that changes the numbers is identifiable,
which is the second decision.

**What actually changes the numbers.** Exactly two writes touch a task's
status distribution: `create` (adds a row, so `total` and the count for its
starting status) and a status change. Before this ADR, there was no way to
change a task's status after creation — `assign` sets `assigneeId`, not
`status`. Caching stats meaningfully requires a task to actually reach
`DONE`, so `PATCH /tasks/:id/status` is added alongside the cache itself,
not as a separate feature. `assign` is deliberately not an invalidation
trigger: it does not change any count `stats` reports, and invalidating
against a write that cannot affect the cached value would be defending
against nothing.

## Decision

`GET /tasks/stats` is cached in Redis under `stats:tasks:{organizationId}`
— one key per organization, since the endpoint aggregates across all of an
org's tasks and nothing narrower. `tasks.service.ts` depends on a narrow
`Cache` interface (`src/lib/cache.ts`: `get`/`set`/`del`), the same shape as
`NotificationsQueue` and `Pingable` — the operations actually used, not a
raw `ioredis` client. `create` and the new `updateStatus` both call
`cache.del` on that key after their write commits; `stats` checks the cache
first and only runs the `groupBy` on a miss.

The `set` still carries a TTL (300s) as a backstop against a missed
invalidation path this decision did not anticipate, not as the mechanism
this cache relies on for freshness. The two explicit `del` calls are what
actually keep it correct.

`tasks.routes.test.ts` proves this rather than asserting it: creating a task
through Prisma directly (bypassing the service, standing in for "some other
process wrote to the table") leaves the cached count unchanged, while the
same write through `POST /tasks` and `PATCH /tasks/:id/status` updates it
immediately. A test that only checked "the endpoint returns the right
number" would pass identically whether the cache worked, was misconfigured,
or did not exist.

The ordinary suite runs against the same in-memory fake pattern as
`NotificationsQueue` and `Pingable` (`test/support.ts`'s `cache`, backed by
a real `Map`, not stubbed responses) — real enough for the invalidation
tests above to mean something, without touching Redis. `lib/cache.test.ts`
is the deliberate exception, proving `createRedisCache`'s `get`/`set`/`del`
actually round-trip through `ioredis`. See [ADR-16](0016-background-jobs-with-bullmq.md)
for the reasoning this mirrors.

## Consequences

`Deps` gains a `cache: Cache` field alongside `redis: Pingable`, both backed
by the one Redis connection `server.ts` already opens for the notification
queue — no new infrastructure, a second use of what Week 2 already stood
up.

Adding `updateStatus` inside an ADR about caching, rather than as its own
ordinary feature, is a deliberate call: it exists because the cache would
otherwise have nothing genuine to invalidate against, not because task CRUD
was due for extension. If a future feature needs task status changes for an
unrelated reason, this is where that endpoint already lives.

This cache is scoped narrowly: one endpoint, one key shape, invalidated by
name at each call site. It does not generalize to a cache-aside helper or a
decorator, because there is exactly one cached read in this codebase so far
— building an abstraction for one caller is the same mistake a repository
layer would be for one data source (see the DI section of the roadmap this
project follows). If a second endpoint needs caching, that is when a shared
pattern becomes worth extracting, informed by two real call sites instead of
guessed at from one.

## Known gap, accepted deliberately

`DELETE /api/v1/projects/:id` changes an organization's task counts —
`Task.project` cascades on delete, so removing a project removes every task
in it — but `projects.service.ts` never calls `cache.del` on that
organization's stats key. Found by inspection while reviewing this ADR, not
by a failing test. Until the TTL expires, `stats` can report tasks that no
longer exist.

This is not fixed here, on purpose, and the reasoning is worth recording
rather than leaving the gap silent. Two decisions, considered separately.

**Should the known code path be fixed?** Yes, eventually — it is a genuine
bug, one line (`await cache.del(statsCacheKey(organizationId))` in the
delete method), and there is no argument for leaving a fixable miss
unfixed indefinitely. It is not done in this same change only because it
surfaced after the caching work was already reviewed and accepted; closing
it is tracked as follow-up, not abandoned.

**Should invalidation be made airtight against every possible write?** No
— deliberately rejected, not merely deferred. Explicit `cache.del` calls
can only ever cover writes that go through this codebase's service layer.
A write from anywhere else — a one-off script against the database, a
future admin tool, a migration backfill, a second service sharing this
database — has no way to reach into application code and invalidate a key,
no matter how many call sites are instrumented. The only mechanism that
closes that category for good is invalidation driven from the database
itself (Postgres logical replication or a CDC tool like Debezium tailing
the write-ahead log and evicting the key on every row change, regardless
of who wrote it), which trades a currently-nonexistent piece of
infrastructure for a staleness bound that is already 300 seconds on a
dashboard statistic, not a financial or inventory number where a stale
read causes real harm. That trade is not worth making yet.

The TTL is therefore doing real work, not decorative: it is the actual
backstop for the category of write this design cannot see, not only for
mistakes like the project-delete gap above. Both the known gap and the
unclosable category resolve to the same bound — never wrong for longer
than 300 seconds — which is what makes 300s a considered choice rather
than an arbitrary one.
