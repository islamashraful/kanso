# 12. Create an organization in one transaction

Date: 2026-08-08
Status: Accepted

## Context

Registration produces a user who can reach nothing. Every request names an
organization and is refused unless a membership row proves the caller belongs
to it ([ADR-11](0011-authenticate-with-jwt-authorize-from-the-database.md)), and
nothing in the API creates either. Organizations and memberships exist only
because the test fixtures insert them directly.

Creating one is three writes, not one:

- the `Organization` row,
- a `Membership` joining the creator to it as `OWNER`,
- a first `Project`, because a task must name one ([ADR-10](0010-tasks-carry-organization-and-project.md))
  and a new organization has none.

Run as three sequential calls, a failure between the first and the second
leaves an organization with no members. That row is not merely wrong, it is
unreachable: every query in this codebase is scoped by organization and every
organization is reached through a membership, so nothing in the API can read
it, delete it, or report it. It is invisible garbage that only a direct
database query would ever find.

Compensating in application code — catch the failure, delete what was already
written — is a rollback that has to be written, tested, and can itself fail
partway. Postgres already has one.

The default project is the arguable member of the set. It could be created
lazily instead, on the first task that finds no project. That moves a write
into a read path, and two concurrent first-task requests would both find
nothing and both create one.

## Decision

Create the organization, the owner membership and the default project inside a
single transaction. Either all three exist or none do.

Use Prisma's interactive form, `$transaction(async (tx) => …)`, rather than the
array form used for refresh token rotation. The membership and the project both
need the organization's id, which does not exist until the first write returns,
so the writes cannot be declared up front as an independent batch.

The transaction contains database writes and nothing else. No HTTP calls, no
token signing, no work that can block on something outside Postgres.

The creator's role is `OWNER`, assigned by the service rather than accepted
from the request body.

These routes cannot be guarded by `requireAuth`, which demands an `x-org-id`
and a membership proving the caller belongs to it — the thing being created.
Split the bearer check out as `requireUser`, setting `req.user` and claiming
nothing about tenancy, and mount organizations under it. `requireAuth` calls
the same function, so there is one definition of a valid credential.

## Consequences

The invariant that an organization has at least one owner holds at creation.
It is not maintained afterwards: nothing yet stops the last owner leaving or
being demoted. That belongs with the membership endpoints and is unhandled
until they exist.

An interactive transaction holds a connection for its duration and Prisma
aborts it after five seconds by default. Three inserts on indexed tables are
far inside that, and keeping non-database work out is what keeps it so — the
limit is only reachable by putting something slow inside the callback.

A duplicate slug surfaces as a `P2002` from inside the transaction, which
rolls back the writes that already succeeded. The service catches it and
throws `ConflictError`, so the client sees 409 rather than the 500 an
unhandled Prisma error would produce ([ADR-6](0006-centralized-error-handling.md)).

`requireUser` widens the surface that runs on identity alone. Two routes use
it today, and both are safe there because neither reads existing tenant data:
one creates an organization, the other lists the caller's own memberships.
Anything that reads or writes inside an organization stays behind
`requireAuth`.

Atomicity is only worth claiming if it is tested. A test calls the service
with a user id that does not exist, so the membership insert fails on its
foreign key after the organization row is already written, and asserts nothing
survives. It forces the failure at the second write rather than the third
because that is the one reachable from outside: failing the project insert
would mean substituting the client. Same spirit as the foreign key test in
ADR-10 — the guarantee is checked by making it fail, not by reading the code
that requests it.

Every organization starts with a project nobody asked for. A user who wants a
different structure deletes or renames it, which is a smaller cost than the
first task creation failing with a 404 naming a project the user was never
given a way to create.
