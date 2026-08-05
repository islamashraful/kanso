# 5. Derive validation, types and OpenAPI from one Zod schema

Date: 2026-08-05
Status: Accepted

## Context

Every endpoint needs three things that describe the same shape: runtime
validation of incoming requests, TypeScript types for the handler, and an
OpenAPI definition for documentation.

Maintaining them separately guarantees drift. The usual outcome is validation
that is correct, types that are approximately correct, and documentation that
was accurate a month ago. NestJS avoids this by generating docs from
decorators on validated DTOs; Express has no equivalent out of the box.

## Decision

One Zod schema per endpoint, in `<feature>.schema.ts`, is the source for all
three:

- **Validation** — a single `validate({ body, query, params })` middleware
  parses against the schema and rejects malformed input at the boundary.
- **Types** — derived with `z.infer`, never hand-written.
- **OpenAPI** — generated via `@asteasolutions/zod-to-openapi`, served as
  `/openapi.json`.

Because Express 5 makes `req.query` a getter, validated output is attached to
`req.validated` (typed by module augmentation) rather than written back over
the request.

Config is validated the same way: `process.env` is parsed through Zod once at
startup, in `src/config/` and nowhere else, so a missing variable fails the
process at boot instead of surfacing as `undefined` under load.

## Consequences

The three artefacts cannot disagree, because there is only one definition. If
the documentation renders something unexpected, the schema is wrong, and the
validation was wrong too.

Schemas become load-bearing. A change to one is a change to the API contract,
the handler's types and the published documentation at once, which is the
intended effect but makes them worth reviewing carefully.

This couples the project to Zod and to the OpenAPI generator's Zod
compatibility, so the generator's supported Zod major is checked before
upgrading either.

Documentation is a rendering concern only. The spec at `/openapi.json` is the
artefact that matters, since it imports into API clients and generates typed
consumers; the UI in front of it is swappable in one line.
