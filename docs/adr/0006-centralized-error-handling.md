# 6. Handle all errors in one middleware, with a typed error class

Date: 2026-08-05
Status: Accepted

## Context

The default Express pattern, repeated in most tutorials, wraps every handler
in `try/catch` and responds with `res.status(500).json(...)` on failure. The
result is error-shaping logic duplicated per route, responses whose shape
varies by endpoint, and no single place to add logging or reporting later.

NestJS solves this with exception filters. Express needs an explicit
equivalent, which [ADR-1](0001-use-express-5-instead-of-nestjs.md) commits to
providing.

## Decision

Three pieces, established before the first route exists so no handler ever
invents its own convention.

**An `AppError` base class** carrying an HTTP status, a machine-readable code,
and an `isOperational` flag separating expected failures from genuine bugs.
Small subclasses (`NotFoundError`, `ForbiddenError`, `ValidationError`) are
what application code throws.

**A `notFound` handler** after all routes, so unmatched paths produce the same
response shape as everything else.

**One error middleware**, registered last, taking all four arguments
`(err, req, res, next)` — Express only treats a handler as error middleware if
its arity is exactly four. It maps `AppError` to its status and code, treats
anything else as a 500 with the detail withheld, and emits a single consistent
JSON shape.

Handlers do not use `try/catch` for control flow. Express 5 forwards rejected
promises from `async` handlers to the error middleware automatically, so
throwing is sufficient:

```ts
const task = await tasksService.getById(id)
if (!task) throw new NotFoundError('Task not found')
```

## Consequences

Error responses are uniform across the API, and consumers can branch on a
stable `code` rather than parsing prose.

Handlers get shorter and read as the happy path, because failure is an
exception rather than a branch.

Cross-cutting concerns attach in one place. Request-scoped logging, error
reporting and alerting all hook into a single function rather than being
threaded through every route.

The `isOperational` distinction is what keeps internals from leaking: expected
failures return their message, unexpected ones return a generic 500 while the
detail goes to the logs.

The cost is a convention that must hold everywhere. One handler that catches
and responds directly silently opts out of all of the above, so this is
explicitly on the review checklist.
