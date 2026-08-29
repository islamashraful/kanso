# 19. Request-scoped logging via AsyncLocalStorage, not an injected dependency

Date: 2026-08-29
Status: Accepted

## Context

Structured logging (`pino`) needed a way for a log line written deep in a
service to carry the same request id as the HTTP request/response summary
line for that request, without every function on the call path accepting
and forwarding a logger argument by hand.

This project's standing convention, argued for in
[ADR-3](0003-explicit-factory-wiring-no-di-container.md), is that a service
never reaches out and grabs a dependency — it receives one, as a plain
argument, so a test can substitute a fake without module mocking. Every
existing cross-cutting dependency (`db`, `cache`, `notifications`,
`objectStore`) follows this: constructed once in `app.ts`, passed through
`Deps`, threaded into whichever service constructor needs it.

The obvious option was to do the same for logging: add `logger: Logger` to
`Deps`, thread it into every service constructor, call `deps.logger.child(...)`
per request. That was rejected. ADR-3's reasoning for injection is
specifically testability — swapping a real dependency for a fake the
ordinary suite can assert against. A logger fails that test on both counts:
no test in this codebase asserts on log output, and there is nothing to
fake — `pino`'s own output is already silenced under `bun test`
(`lib/logger.ts`). Growing every service constructor's signature to carry a
dependency no test will ever use is paying ADR-3's cost without collecting
its benefit.

The alternative is Node's `AsyncLocalStorage`: a value bound once, at the
top of a request, that is implicitly available to any code running inside
that request's call stack — no matter how many layers deep — without being
passed as an argument at any of them.

## Decision

`middleware/request-logger.ts` opens one `AsyncLocalStorage` context per
request, keyed by a request id (reused from an incoming `x-request-id`
header if the caller sent one, generated otherwise), holding a `pino` child
logger already tagged with that id. `lib/request-context.ts` exposes this as
a single function, `getLogger()`, which any code — a controller, a service,
anywhere downstream of the middleware — calls directly to get the current
request's logger, or the plain base logger if called outside a request
(the worker process, a script, module init).

Services call `getLogger()` themselves rather than receiving a logger
through their constructor. This is the one dependency in the codebase
deliberately reached for instead of injected.

## Consequences

No service constructor grows a `logger` parameter, and `Deps` gains nothing
for this. Adding a log line inside a service is a one-line, zero-signature-change
addition — the friction ADR-3 accepts for genuine dependencies (a fake to
maintain in `test/support.ts`, a constructor argument at every call site) is
avoided here because it would be bought for no real return.

The trade this makes: `getLogger()` is a form of global reach, the exact
shape ADR-3 exists to avoid for everything else. That is deliberately
acceptable for logging specifically, because the property ADR-3 protects —
a seam a test can substitute — is not a property logging needs. It would
not be acceptable for a dependency a test does or should care about (the
database, the cache, the queue, the object store), which is why those stay
injected and this is the one exception, not a precedent for reconsidering
them.
