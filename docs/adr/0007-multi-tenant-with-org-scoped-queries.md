# 7. Model tenancy explicitly, with org-scoped queries and middleware authorization

Date: 2026-08-05
Status: Accepted

## Context

Kanso manages tasks for teams. Tenancy could be modelled two ways: a
single-tenant app where all data belongs to one implicit organization, or a
multi-tenant app where an organization is a first-class entity and every
record belongs to one.

Single-tenant is simpler, and reduces the data model to users and their tasks.
Multi-tenant introduces an ownership hierarchy, per-organization roles, and
the obligation to scope every query.

Multi-tenancy is where the interesting problems live. Isolation between
tenants is a correctness and security property that has to be enforced
consistently rather than remembered per query, and it is the constraint that
makes authorization, ownership and query design non-trivial.

Isolation could be enforced in three places: Postgres row-level security,
a global query middleware, or explicitly in each service.

## Decision

Model organizations as first-class entities. Ownership flows
org → project → task, with membership as a join table carrying a role of
owner, admin or member.

Enforce isolation in two layers:

**Authorization is middleware.** `requireAuth` establishes identity;
`requireOrgRole('admin')` establishes permission within an organization.
Both are mounted per-router, never written as conditionals inside handlers.

**Queries are scoped in services.** Every read and write filters on the
organization derived from the authenticated request, never from a
client-supplied value.

Row-level security is not used. It is the stronger mechanism, but it moves
authorization into the database and away from the code under test, which
works against this project's aim of making isolation visible and explicit.

## Consequences

The isolation guarantee is only as good as its enforcement, so it is tested
rather than asserted. Every resource has a test proving a member of one
organization cannot read or modify another's data, and that a member cannot
perform admin-only actions.

Scoping is a rule that must hold in every service method. A single unscoped
query is a cross-tenant data leak, which makes it the highest-value thing to
look for in review, and the reason authorization is middleware rather than
inline: a check in one file can be shown to apply everywhere.

Deriving the organization from the authenticated request rather than the
request body is what closes the obvious attack, where a caller supplies
another tenant's identifier.

Every list endpoint is filtered by organization from the start, which makes
the index requirements clear early rather than emerging as slow queries later.
