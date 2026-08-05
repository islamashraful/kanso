# 3. Wire dependencies with explicit factories, not a DI container

Date: 2026-08-05
Status: Accepted

## Context

Choosing Express ([ADR-1](0001-use-express-5-instead-of-nestjs.md)) means
giving up Nest's dependency injection. The question is what replaces it.

The useful thing DI provides is testability: code under test can be handed a
substitute for a collaborator without the test reaching into module internals.
Layering alone does not give this. A service can be perfectly layered and
still `import { db } from '../lib/prisma'`, which means it reaches out and
grabs its dependency rather than receiving it. Substituting that in a test
requires module mocking, which couples tests to file paths and breaks when
files move.

The options were a container (`awilix`, `tsyringe`), plain factory functions,
or direct module imports with mocking where needed.

## Decision

Services are factory functions that receive their dependencies as arguments
and return an object of operations. They are wired in a single composition
root, `src/app.ts`.

```ts
export const createTasksService = (db: PrismaClient) => ({
  list: (orgId: string, query: ListTasksQuery) => { /* ... */ },
})
```

No DI container.

## Consequences

Substituting a dependency in a test is a function argument. No mocking
framework, no module interception, nothing coupled to file paths.

Wiring is explicit and greppable: `src/app.ts` shows the entire object graph
in one screen. The cost is that it is manual, and it grows linearly with the
number of modules. At this project's scale that is a feature, since the
alternative is auto-resolution that hides the graph.

Worth being honest about where this pays off. A fake Prisma client tests
little of value in a service that is mostly queries, since the assertions end
up checking the mock. The dependencies where injection genuinely earns its
place are the ones that are painful in tests: the S3 client, the email sender,
the clock, and the queue. Database behaviour is covered by integration tests
against real Postgres instead.

This buys substituting a *fake in a test*, not swapping a *real
implementation*. Replacing Prisma with another ORM would require services to
depend on an interface rather than the concrete client, which is a repository
layer and a much larger commitment. Not taken here.
