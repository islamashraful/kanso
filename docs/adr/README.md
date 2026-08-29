# Architecture Decision Records

Each record captures one decision where a reasonable alternative existed and
was rejected for stated reasons. Records are numbered in the order they were
written and are immutable once accepted: if a decision is reversed, a new
record supersedes the old one rather than editing it.

Format is [Michael Nygard's](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions):
context, decision, consequences. See [`0000-template.md`](0000-template.md)
for the shape and [`../writing.md`](../writing.md) for the conventions.

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
| [9](0009-integration-tests-against-a-real-database.md) | Integration tests against a real, separate database | Accepted |
| [10](0010-tasks-carry-organization-and-project.md) | Tasks carry both project and organization | Accepted |
| [11](0011-authenticate-with-jwt-authorize-from-the-database.md) | Authenticate with JWT, authorize from the database | Accepted |
| [12](0012-create-an-organization-in-one-transaction.md) | Create an organization in one transaction | Accepted |
| [13](0013-ordered-roles-rather-than-a-permission-matrix.md) | Ordered roles rather than a permission matrix | Accepted |
| [14](0014-offset-pagination-behind-a-response-envelope.md) | Offset pagination, behind a response envelope | Accepted |
| [15](0015-generate-the-openapi-document-from-zod.md) | Generate the OpenAPI document from Zod, rendered by Scalar | Accepted |
| [16](0016-background-jobs-with-bullmq.md) | Background jobs with BullMQ, queue as a fakeable dependency | Accepted |
| [17](0017-cache-task-stats-with-explicit-invalidation.md) | Cache task stats in Redis, invalidated explicitly on the writes that change them | Accepted |
| [18](0018-presigned-post-uploads-with-a-confirm-step.md) | Task attachments via presigned POST, confirmed by a server-side HEAD | Accepted |
| [19](0019-request-logging-via-asynclocalstorage-not-injection.md) | Request-scoped logging via AsyncLocalStorage, not an injected dependency | Accepted |
