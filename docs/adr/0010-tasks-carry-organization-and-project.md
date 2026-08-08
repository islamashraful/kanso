# 10. Give tasks a project, and keep the organization on the task itself

Date: 2026-08-06
Status: Accepted

## Context

Tasks currently belong directly to an organization. The realistic model has a
project in between: an organization contains projects, and a project contains
tasks.

Adding that layer raises a question about where the tenant lives. Every query in
this codebase filters by organization
([ADR-7](0007-multi-tenant-with-org-scoped-queries.md)), so how a task reaches
its organization matters more than it would in a single-tenant application.

**Normalized.** The task holds only `projectId`, and the organization is reached
through the project. One place stores the fact, so it cannot disagree with
itself. Every org-scoped query then needs a join:

```ts
db.task.findMany({ where: { project: { organizationId } } });
```

**Denormalized.** The task holds both `projectId` and `organizationId`. Queries
stay direct, and the tenant filter reads identically on every model:

```ts
db.task.findMany({ where: { organizationId } });
```

The risk is drift. A task could point at a project in one organization while its
own `organizationId` names another, which is a cross-tenant leak produced by a
single typo, in exactly the code path that is supposed to prevent leaks.

## Decision

Add a `Project` model. Tasks carry both `projectId` and `organizationId`, and
the pair is made consistent by the database rather than by convention.

A composite unique on `Project` lets the task's foreign key reference the pair
rather than the id alone:

```prisma
model Project {
  id             String @id @default(uuid(7))
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([id, organizationId])
}

model Task {
  projectId      String
  organizationId String

  project Project @relation(fields: [projectId, organizationId], references: [id, organizationId], onDelete: Cascade)
}
```

Postgres then rejects any task whose organization disagrees with its project's.
The denormalization is safe because the invariant is enforced, not remembered.

Deletes cascade down the chain: removing an organization removes its projects,
and removing a project removes its tasks.

## Consequences

Org-scoped queries stay join-free, and the filter looks the same on tasks as on
every other model. That uniformity is the point: a query missing its
organization filter should be visually obvious in review, which is harder when
some models are filtered directly and others through a relation.

The consistency guarantee holds in code written months from now, including code
that forgets this record exists. That is the same reason constraints live in the
database elsewhere in this schema
([ADR-7](0007-multi-tenant-with-org-scoped-queries.md)).

The cost is a wider foreign key, a column that is derivable in principle, and
the index behind the composite unique, which duplicates what the primary key
already covers. Nothing else needed special handling: Prisma took
`organizationId` backing two relations at once, the direct one to
`Organization` and the composite one to `Project`, without complaint. Anyone
reading the schema may reasonably ask why the organization appears twice; the
composite reference is the answer, and it is worth a comment at the model.

The constraint's failure mode has to be handled rather than left to surface. A
task created against another organization's project is an ordinary client
mistake, but the foreign key reports it as a constraint violation, which the
error middleware reads as a bug and returns as a 500
([ADR-6](0006-centralized-error-handling.md)). So `tasks.create` looks the
project up scoped to the organization first and throws `NotFoundError`,
matching the 404 that reading a foreign project already returns. The lookup is
not atomic and is not the guarantee; it only shapes the error. The constraint
remains the enforcement, which is only worth claiming if it is tested.
`src/modules/projects/projects.routes.test.ts` writes
a mismatched pair through the Prisma client, bypassing the service and its
lookup, and asserts Postgres refuses it: a `P2003` foreign key violation naming
the `tasks_projectId_organizationId_fkey` constraint.

Moving a task between projects now means moving it within one organization, or
updating both columns together. Cross-organization moves are rejected by the
foreign key, which is the correct outcome.

This lands before tasks carry real data. Doing it afterwards would mean
backfilling `projectId` on existing rows and choosing a project for tasks that
never had one.
