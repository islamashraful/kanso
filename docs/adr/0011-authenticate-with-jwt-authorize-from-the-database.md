# 11. Authenticate with JWT, authorize from the database

Date: 2026-08-08
Status: Accepted

## Context

Authentication is currently scaffolding. `requireAuth` reads an `x-user-id`
header and trusts it, then reads an `x-org-id` header and trusts it only after
a membership row proves the caller belongs to that organization. The second
half is real; the first half asserts nothing.

Replacing it raises two questions, and they are independent.

**How the caller proves identity.** A server session stores state and hands
back an opaque id: revocation is immediate, because deleting the row ends the
session. The cost is a session store to run and a lookup on every request,
including the WebSocket handshake in week 2. A signed token carries the claim
instead, so identity needs no lookup at all — but a token cannot be withdrawn
before it expires, because nothing was stored to delete.

**What the token carries.** Putting `organizationId` and `role` in the payload
makes it self-contained, and the request needs no database access to authorize.
But both facts change. A member removed from an organization, or demoted from
admin, keeps whatever the token already asserts until it expires. The window is
bounded by the token lifetime, not by the change.

That second question matters more here than it would elsewhere. This project's
central claim is that one organization cannot read another's data, enforced and
tested rather than asserted ([ADR-7](0007-multi-tenant-with-org-scoped-queries.md)).
A removed member who keeps reading for another fifteen minutes qualifies it.

## Decision

Issue a short-lived access token and a longer-lived refresh token. The refresh
token is stored and rotated on use, so a stolen one can be invalidated; the
access token is short enough that it need not be.

The access token carries `sub` and the standard registered claims. It does not
carry the organization or the role.

Identity comes from the token. Authorization comes from the database on every
request: the organization stays a client-supplied header, verified against a
membership row before anything downstream sees it, exactly as it works now.

Verification lives in a standalone `verifyToken` function rather than inside
the middleware, and the signing key is read through the Zod-parsed config so a
missing key fails at boot rather than at the first login.

## Consequences

Removing a member or changing a role takes effect on the next request. Nothing
is qualified by a token lifetime, so the isolation guarantee reads the same in
prose as it does in the tests.

The per-request membership query is the price, and it is one lookup on a unique
index. It buys more than it costs here: role-based middleware needs the role
anyway, so moving the organization into the token would remove no queries while
adding a staleness window — the saving is imaginary and the cost is not.

`req.auth` keeps its shape, so controllers and services are untouched and the
existing isolation tests carry over unchanged. That is the separation
[ADR-1](0001-use-express-5-instead-of-nestjs.md) exists to protect: the stub
could be swapped for real authentication without anything downstream noticing.

Keeping `verifyToken` separate from the middleware is what lets week 2's
WebSocket handshake reuse it, where there is no `req` or `res` to pass.

The organization header remains untrusted input, which is fine as long as it is
never used before it is verified. The response for a caller who is not a member
stays identical to the response for an organization that does not exist, so the
header cannot be used to discover which tenants are real.

The costs are two token lifetimes to reason about, a refresh endpoint and its
rotation logic, and somewhere to persist refresh tokens — the first table in
this schema that exists for the mechanics of the application rather than its
domain.
