# 1. Use Express 5 instead of NestJS

Date: 2026-08-05
Status: Accepted

## Context

Kanso is a multi-tenant task management API. The two obvious choices for the
HTTP layer in the Node ecosystem are Express and NestJS.

NestJS ships a complete set of opinions: modules, dependency injection,
guards, pipes, exception filters, and decorator-driven OpenAPI generation.
Those opinions are genuinely valuable, and they are the main reason it is
popular for services expected to grow.

Express ships none of them. It is a routing and middleware library, and every
structural decision is left to the author.

The deciding factor is where the effort goes. Nest's conventions are a
framework to learn in their own right, and time spent learning them is time
not spent on the backend concepts this project exists to exercise:
multi-tenancy, transactions, caching, queues, and deployment. Express is
already familiar, so none of the budget goes to the framework itself.

## Decision

Use Express 5 with TypeScript.

Express 5 specifically, for two behaviours that remove long-standing
boilerplate: rejected promises from `async` handlers are forwarded to the
error middleware automatically, and `req.query` is a getter, which forces
validated input somewhere explicit rather than mutating the request.

## Consequences

The structural discipline Nest enforces has to be imposed deliberately
instead. That is the cost, and it is paid in [ADR-3](0003-explicit-factory-wiring-no-di-container.md),
[ADR-4](0004-feature-based-folder-structure.md),
[ADR-5](0005-zod-as-single-source-of-truth.md) and
[ADR-6](0006-centralized-error-handling.md), each of which replaces a specific
Nest feature with an explicit equivalent. Without those, this decision would
produce exactly the unstructured Express codebase the framework is criticised
for.

Every Nest concept still has a direct counterpart here, which keeps the
decision reversible in principle: module maps to feature folder, guard to
middleware, pipe to validation middleware, exception filter to the error
middleware, and gateway to a Socket.IO server on the same HTTP server.

The routing layer stays thin and unremarkable, which means the interesting
parts of the codebase are the domain logic and the infrastructure rather than
framework configuration.
