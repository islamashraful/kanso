# Architecture Decision Records

Each record captures one decision where a reasonable alternative existed and
was rejected for stated reasons. Records are numbered in the order they were
written and are immutable once accepted: if a decision is reversed, a new
record supersedes the old one rather than editing it.

Format is [Michael Nygard's](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions):
context, decision, consequences. See [`0000-template.md`](0000-template.md).

| # | Decision | Status |
|---|----------|--------|
| [1](0001-use-express-5-instead-of-nestjs.md) | Express 5 instead of NestJS | Accepted |
| [2](0002-bun-as-runtime-and-toolchain.md) | Bun as runtime, package manager and test runner | Accepted |
| [3](0003-explicit-factory-wiring-no-di-container.md) | Explicit factory wiring, no DI container | Accepted |
| [4](0004-feature-based-folder-structure.md) | Feature-based folder structure | Accepted |
| [5](0005-zod-as-single-source-of-truth.md) | Zod as the source of validation, types and OpenAPI | Accepted |
| [6](0006-centralized-error-handling.md) | Centralized error handling | Accepted |
| [7](0007-multi-tenant-with-org-scoped-queries.md) | Multi-tenant with org-scoped queries | Accepted |
| [8](0008-bun-test-as-test-runner.md) | `bun test` as the test runner | Accepted |
