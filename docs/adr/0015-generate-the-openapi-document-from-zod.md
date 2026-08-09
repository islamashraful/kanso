# 15. Generate the OpenAPI document from Zod, rendered by Scalar

Date: 2026-08-09
Status: Accepted

## Context

The API has thirteen operations and no reference. The shapes they accept are
already written down as Zod schemas, because those schemas validate every
request ([ADR-5](0005-zod-as-single-source-of-truth.md)).

A hand-written OpenAPI file is the obvious alternative and the one to reject.
It starts accurate and stops being accurate at the first endpoint someone
changes without remembering it exists. Nothing fails when the two disagree,
which is the problem: a document that lies silently is worse than no document,
because a reader trusts it. Decorator-driven generation — the NestJS answer —
solves the same problem by attaching metadata to the handler, but it needs a
framework built around decorators to hang them on.

Generating from the validation schemas removes the second definition entirely.
A parameter the document describes is one the API enforces, because they are
the same object.

Two libraries do this for Zod. `@asteasolutions/zod-to-openapi` was tried
first and abandoned: it works by patching `.openapi()` onto Zod's prototype,
and Zod 4 attaches methods per instance, so any schema constructed before the
patch runs never receives the method. Since the schemas are imported by the
routers, and the routers are wired before the document is built, this fails at
startup with `zodSchema.openapi is not a function` — but only once the module
graph is large enough for the ordering to go wrong, which is to say not in a
five-line reproduction. `zod-openapi` uses Zod 4's native `.meta()`, so
metadata rides on the schema at construction and no import order can break it.

The renderer is a separate and much smaller decision. Swagger UI is the
default and looks it. Scalar reads the same document, renders it better, and
carries a request client so a reader can fire a call from the page. Redoc
reads better still but has no client.

## Decision

Generate the document from the Zod schemas with `zod-openapi`. Serve it at
`/openapi.json` and render it with Scalar at `/reference`.

Document each module's paths in `<module>.openapi.ts`, beside the routes they
describe, and compose them in `src/openapi/document.ts`. A central spec file
would be a second place to remember, which is the failure this decision
exists to avoid; a new endpoint is documented in the folder it was added to.

Serve both paths outside `/api/v1` and outside `requireAuth`. The document
describes the shape of the API, not any tenant's data, and every operation in
it already states what it requires. A reference nobody can open documents
nothing.

Declare `security: [{ bearerAuth: [] }]` at the document level and override it
with `security: []` on the four auth paths. The default is the safe direction:
a path added without thinking about authentication is documented as requiring
it, and the exception has to be written deliberately.

Write response schemas by hand, and pin them to the Prisma models with two
type-level assignments per model (`src/lib/serialized.ts`). Request schemas
are already the validators, so they cannot drift; responses have no such
anchor, because what leaves a service is a Prisma row rather than a parsed
Zod value. The two assignments fail to compile if the documented shape and the
model disagree in either direction — a field invented in the schema, or a
column added to the model and never documented.

Test the properties the generation is relied on for, not the prose: that
exactly the four auth paths are public, that `x-org-id` is documented on
precisely the organization-scoped routes, and that the document lists neither
more nor fewer operations than the app serves.

Read that last list from Express rather than writing it down. A test comparing
the document to a hand-written list of endpoints checks only that the document
has not changed: adding a route to a router and never documenting it leaves
both sides at their previous value and passes. `src/openapi/route-table.ts`
walks `app.router.stack` instead, so the comparison is against what the
application will actually serve.

## Consequences

Response schemas are a second definition of the same shape, which is the thing
this record otherwise argues against. The type assertions make the duplication
checked rather than trusted, but they only cover shapes backed by a Prisma
model: `AuthResponse` and the page envelope have no model to be compared to
and are held true by tests alone.

The reference is unauthenticated, so the full list of endpoints, their
parameters and their error codes is public once the API is. That is
deliberate — none of it is a secret worth keeping, and treating an endpoint
list as one would be security by obscurity — but it is a decision, not an
oversight, and it would need revisiting for an API with an internal surface.

Adding an endpoint now means editing two files in the module rather than one.
Forgetting the second fails the coverage test naming the missing operation,
and a whole module mounted but never composed into `document.ts` fails it as
an unresolved router — both verified by adding each and watching the suite go
red, rather than assumed from reading the test.

Reading `app.router.stack` is reading Express internals, and no public API
offers the same thing. An Express upgrade can change that shape, and the
mitigation is that the helper throws when it cannot find the stack rather than
returning an empty table, since an empty table would let the coverage test
pass while comparing nothing to nothing. The mount prefix is the fiddly part:
a layer knows its path relative to its own mount, so prefixes are recovered by
asking each router's matcher about paths already known to route.

`.meta({ id })` on a schema is what promotes it to a named component. Removing
one silently inlines the shape at every use instead of failing, so the set of
component names is asserted in the test rather than left to inspection.

The document is built once when the app is composed, not per request. It
cannot change while the process runs, and rebuilding it per request would walk
every schema in the application to produce identical bytes.
