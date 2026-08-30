# 20. Rate limiting, by identity where available, IP otherwise

Date: 2026-08-30
Status: Accepted

## Context

Two things were left unlimited. [ADR-18](0018-presigned-post-uploads-with-a-confirm-step.md)
named the first explicitly as Week 3 hardening: `POST
/tasks/:taskId/attachments/presign` hands out a signed credential for a real
S3 write, and nothing capped how many one caller could mint. The second was
never named anywhere, because nothing about it is specific to attachments:
no endpoint in the API had any limit on request volume at all, including
`POST /auth/login`, the one place an unlimited request rate is a textbook
attack (password brute-forcing), not just a cost or abuse concern.

Those two problems are not the same shape, and one limiter cannot solve
both well.

**The presign case is about volume from one identity.** The caller is
already authenticated by the time the endpoint runs — `requireAuth` set
`req.auth.userId` before the router's own middleware sees the request — so
the natural key is that verified user id. IP is the wrong key here: it is
weaker than an identity Kanso already has, and it groups unrelated callers
together for no reason (a shared office network, a corporate VPN exit).

**The login case is about volume against one target, from callers who by
definition have no verified identity yet.** IP is the only signal
available before a token exists, but IP alone is both too broad and too
easy to defeat: two different people signing in to two different accounts
from the same Wi-Fi would share one budget (an innocent user gets throttled
because someone else on their network is doing something unrelated), while
someone with a botnet or a rotating proxy can spread a brute-force attempt
across enough IPs that each one alone never crosses the threshold.

**Everything else needs a blunt, generic floor.** A script gone wrong, a
retry loop with no backoff, or plain anonymous flooding of any endpoint —
none of this is precise abuse of one feature, it is volume against the API
as a whole, and it can arrive before authentication is even attempted.

## Decision

Two layers, both built on one small factory, `createRateLimiter`
([src/lib/rate-limit.ts](../../src/lib/rate-limit.ts)), wrapping
`express-rate-limit` with a Redis-backed store
(`rate-limit-redis`) and a handler that throws `TooManyRequestsError`
rather than using the library's own default response — a 429 gets the same
JSON error shape as everything else in the API, not a one-off exception to
it.

**A global limiter**, mounted with `app.use` immediately after the health
router and before `express.json()`, so it runs ahead of authentication and
protects everything behind it, including the auth check itself. Keyed by
IP (`express-rate-limit`'s `ipKeyGenerator`, which also masks IPv6
addresses to a /56 so one caller can't split across addresses within their
own assigned block to reset their count). Loose on purpose — 300 requests
per minute — because its job is catching floods and runaway clients, not
precisely attributing abuse to one person; ordinary use, even a busy shared
connection, is nowhere near that number.

**A login limiter**, mounted on `POST /auth/login` only, keyed by IP *and*
the email being attempted (`` `${ipKeyGenerator(req.ip)}:${email}` ``), with
`skipSuccessfulRequests: true` so a login that actually succeeds never
counts against the budget. Five failures per fifteen minutes. Keying on the
pair rather than IP alone means two different accounts on one IP never
share a budget, and a legitimate user is never punished for other traffic
on their network; keying on the pair rather than email alone still bounds
how much one IP can throw at the login endpoint in total, since each wrong
guess against a *different* email from the same IP opens a new bucket
capped at five failures of its own.

**A presign limiter**, mounted on `POST
/tasks/:taskId/attachments/presign` only, keyed by `req.auth.userId` — safe
because it is built and used entirely after `requireAuth`. Twenty per ten
minutes. Not `skipSuccessfulRequests`: every presign counts, since the
concern is total vouchers minted, not failures.

All three share one Redis connection — the same one BullMQ and `Cache`
already use ([ADR-16](0016-background-jobs-with-bullmq.md),
[ADR-17](0017-cache-task-stats-with-explicit-invalidation.md)) — rather
than a new one. `maxRetriesPerRequest: null`, set where that connection is
created for BullMQ's sake, is a connection-level option any consumer of the
same connection inherits; nothing about sharing it conflicts with rate
limiting. Each limiter's Redis keys are namespaced by a `ratelimit:<prefix>:`
prefix so the three counters can never collide with each other or with
caching's keys on the same connection.

`Deps.redisClient` is a new, **optional** field carrying the raw `ioredis`
connection, separate from the existing `Deps.redis: Pingable` used for
health checks. `RedisStore` needs to send raw commands (`.call(...)`),
which `Pingable`'s single `ping()` method deliberately does not expose.
When `redisClient` is omitted — every test in the suite — `createRateLimiter`
leaves `store` unset and express-rate-limit falls back to its own built-in
in-memory store. That store is exact for a single test process (there is
no second instance for counts to disagree across, which is the only
problem a shared store solves), so this is not a weaker stand-in the way
`test/support.ts`'s fakes for `Cache` or `NotificationsQueue` are — it is
the same code path exercised on the same real state, just not persisted
past the process. `lib/rate-limit.test.ts` is the deliberate real-Redis
exception, mirroring `lib/cache.test.ts` and `lib/s3.test.ts`: it builds a
throwaway Express app with a real `redisClient`, drives it past its limit,
and confirms the keys actually landed in Redis.

## Consequences

**Rejected: one limiter with conditional logic.** A single middleware
branching on "is this the login route, is this authenticated" would still
need different keys, windows and thresholds per case, so nothing would
actually be shared except the branching itself — three small, independently
configured instances of the same factory is less code, not more.

**Rejected: keying the global limiter by user id when a token is present.**
Trusting an unverified user id as a rate-limit key would let an attacker
mint a fresh key on every request just by changing an unsigned claim,
defeating the limiter entirely. Verifying the token first would make the
global limiter redundant with `requireAuth`, which already does that
verification — and it still would not help, since the global limiter's
entire reason to exist is to run *before* that check. It stays IP-only,
unconditionally.

**`req.ip` is trusted as given.** Nothing in this codebase sets Express's
`trust proxy`, which is correct with no reverse proxy in front today. Once
Week 4 puts an ALB in front of ECS, every request arrives from the load
balancer's address unless `trust proxy` is set for exactly one hop — every
IP-keyed limiter here would otherwise see one address for all traffic,
which is both useless as a limiter and, if `trust proxy` were instead set
too permissively, spoofable via a client-supplied `X-Forwarded-For` header.
Recorded in `docs/architecture.md`'s "Not here yet" rather than guessed at
now, the same way the S3 credential requirement was flagged ahead of
Week 4 rather than fixed speculatively before the real infrastructure
exists to test it against.

**No distributed brute-force protection across many IPs, and no CAPTCHA.**
An attacker spreading login attempts across enough distinct IPs still gets
five tries per IP-email pair before any one bucket trips. Closing that
needs a different signal entirely (device fingerprinting, a CAPTCHA after
N global failures for one account) and is not worth building until it is
an observed problem rather than a theoretical one — the same "not worth new
infrastructure yet" judgment [ADR-17](0017-cache-task-stats-with-explicit-invalidation.md)
and [ADR-18](0018-presigned-post-uploads-with-a-confirm-step.md) each made
about their own deferred gaps.
