# 4. Organize source by feature, not by technical type

Date: 2026-08-05
Status: Accepted

## Context

Two conventional layouts exist for a Node API. Grouping by technical type
puts every controller in `controllers/`, every service in `services/`, and so
on. Grouping by feature puts everything about tasks in `modules/tasks/`.

Type-based grouping is what most Express tutorials show. Its weakness appears
during change rather than at rest: adding a field to a task touches four
directories, and nothing in the layout indicates which files belong together
or what the application is actually about.

## Decision

Group by feature.

```
src/
  app.ts                  # composition root; builds the app, never listens
  server.ts               # process concerns: listen, graceful shutdown
  config/index.ts         # Zod-parsed env; the only reader of process.env
  modules/
    tasks/
      tasks.routes.ts
      tasks.controller.ts
      tasks.service.ts
      tasks.schema.ts
      tasks.routes.test.ts
    projects/
    orgs/
    auth/
  middleware/             # requireAuth, requireOrgRole, validate, errorHandler
  lib/                    # prisma, redis, logger, AppError
  jobs/                   # queues and workers
```

Within a feature, layering is still enforced: routes declare paths and attach
middleware, controllers unwrap requests and shape responses, services hold
logic and never touch `req` or `res`.

## Consequences

A change is scoped to one directory, and the top level of `src/modules/`
describes the domain rather than the framework.

Tests live beside the code they cover, which makes a module missing tests
visible at a glance instead of requiring a cross-reference against a separate
tree.

Cross-cutting concerns do not fit the pattern and get their own top-level
directories (`middleware/`, `lib/`, `jobs/`). This is a real seam, and the
risk is logic drifting into `lib/` because it belongs to no single feature.
Anything domain-specific stays in a module even when two modules use it;
`lib/` is reserved for infrastructure clients and primitives.

This is the closest Express equivalent of a Nest module, which keeps the
mapping in [ADR-1](0001-use-express-5-instead-of-nestjs.md) honest.
