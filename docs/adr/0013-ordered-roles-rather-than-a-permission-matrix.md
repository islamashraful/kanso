# 13. Order the roles rather than enumerate permissions

Date: 2026-08-09
Status: Accepted

## Context

`Membership` carries `OWNER`, `ADMIN` or `MEMBER`, and `requireAuth` puts the
value on `req.auth` for every request
([ADR-11](0011-authenticate-with-jwt-authorize-from-the-database.md)). Nothing
reads it. Every member of an organization can currently do everything inside
it, so the three values are decoration.

How a route says what it requires is the decision, and there are two shapes.

**A permission matrix.** Name the actions — `project:delete`, `member:invite`
— and map each role to the set it holds. Routes demand a permission, never a
role. This is what a system needs once permissions stop nesting: a billing
admin who cannot delete projects, or roles an organization defines for itself.
The cost is a layer of indirection between the route and the answer, and a
table to maintain that is mostly restating an obvious hierarchy while the
hierarchy is all there is.

**Ordered roles.** Rank them, and let a route demand a minimum. `OWNER` can do
what `ADMIN` can do; `ADMIN` can do what `MEMBER` can do. The route reads as
the sentence it is enforcing, and there is no table to consult to know what a
role means. It holds exactly as long as permissions nest, and it cannot
express a role that is more powerful in one respect and less in another.

Three roles that plainly nest do not need a matrix. The risk is that the
choice is hard to walk back later, since it is spread across every guarded
route.

## Decision

Rank the roles `MEMBER` < `ADMIN` < `OWNER` and guard routes with
`requireOrgRole(minimum)`, which throws `ForbiddenError` when the caller's
role ranks below it.

Keep the ranking in one `Record<Role, number>` keyed by the Prisma enum, so
adding a role to the schema fails the typecheck until it is placed in the
order. The ordering cannot silently drift from the model it describes: adding
a fourth role and running `bun run typecheck` fails with TS2741 at the record,
naming the role that has no position.

The middleware runs after `requireAuth` and reads the role that already put on
`req.auth`, so it performs no query of its own. It takes no dependencies and
is imported directly by routers rather than passed through the composition
root, in the same way `validate` is ([ADR-3](0003-explicit-factory-wiring-no-di-container.md)).

Authorization stays middleware. A role checked inside a controller or service
is the thing this exists to prevent
([ADR-1](0001-use-express-5-instead-of-nestjs.md)).

## Consequences

A guarded route declares its requirement where the route is declared, next to
its validation, so reading the router answers who may call what without
opening a service.

The first thing this actually guards is deleting a project, which cascades to
its tasks ([ADR-10](0010-tasks-carry-organization-and-project.md)). That
combination — irreversible, and destructive beyond the row named — is the
clearest case for a role above `MEMBER`, and it is why the endpoint arrives
with the middleware rather than before it.

The failure is 403 and not 404. Elsewhere this codebase hides existence from
non-members, because leaking which organizations exist is a real disclosure
([ADR-7](0007-multi-tenant-with-org-scoped-queries.md)). Here the caller has
already proved membership, so there is nothing left to hide: they are entitled
to know the resource exists and that their role is insufficient. Returning 404
would be misleading rather than protective.

Moving to a permission model later means changing every guarded route, not
just the middleware. That is a real cost, and it is bounded: the call sites
are greppable, each becomes a permission name instead of a role, and the
matrix can be introduced beneath the same middleware signature. It is a
migration, not a rewrite. The condition that would force it is a permission
that does not nest — the point at which ranking stops being able to express
the rule at all.

Nothing yet stops the last `OWNER` leaving an organization, which would strand
it with no one able to perform owner-level actions. That gap was opened by
[ADR-12](0012-create-an-organization-in-one-transaction.md) and is not closed
here; it belongs with the membership endpoints.
