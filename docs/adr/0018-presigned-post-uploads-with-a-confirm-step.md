# 18. Task attachments via presigned POST, confirmed by a server-side HEAD

Date: 2026-08-29
Status: Accepted

## Context

Task attachments are the first feature that moves a file, not JSON, between
a client and this API. The roadmap this project follows originally planned
`multer` with memory storage: the client sends the file to the API, the API
buffers it in memory, then forwards it to S3. That was reconsidered before
implementation, not after — see the rejected alternative below.

Two decisions, not one.

**Where the file goes.** A multer proxy upload puts every attachment's bytes
through the app server: buffered in memory, then written to S3 on the same
request. That scales the app server's memory and bandwidth with attachment
traffic for no reason the server needs — it never inspects the bytes, only
forwards them. The alternative is a presigned POST: the API hands the client
a short-lived, scoped credential (a URL and a set of form fields), and the
client uploads directly to the bucket. The file never touches the app
server.

**What stops the upload from being unrestricted.** A presigned PUT signs a
fixed set of headers, which does not extend to a size range. A presigned
POST signs a *policy document* with real conditions —
`content-length-range`, an exact `content-type` match, and (available but
unused here — see Consequences) `starts-with` on the key — that S3 enforces
against the request the client actually sends, independent of anything this
codebase runs before or after. `createPresignedPost`
(`@aws-sdk/s3-presigned-post`) builds that policy from the same call that
returns the upload URL, so the two cannot drift apart.

## Decision

`POST /tasks/:taskId/attachments/presign` returns a presigned POST scoped to
one server-generated key
(`orgs/{organizationId}/tasks/{taskId}/{uuid}-{fileName}`) and one
content-type, with `content-length-range` capped at
`MAX_ATTACHMENT_SIZE_BYTES` (10 MiB) in the signed policy. The key is never
accepted from the client at this step — only a `fileName` and a
`contentType` drawn from a closed allowlist
(`ALLOWED_ATTACHMENT_CONTENT_TYPES`) are.

The client uploads directly to the bucket with that URL and those fields.
This API never sees the bytes and has no way to know the upload happened —
a presigned POST has no server-side callback. `POST /tasks/:taskId/attachments`
closes that gap: given the `key` back, it runs `HeadObject` against the
bucket and only writes an `Attachment` row if the object actually exists.
`size` and `contentType` on the row come from that HEAD response, not from
the client's original presign request — the two can disagree (a client that
lied at presign time, or whose actual upload differs), and the bucket's
account of what it received is the one trusted.

`tasks.service.ts`'s and `attachments.service.ts`'s dependency on `Db` is
mirrored here: `ObjectStore` (`src/lib/s3.ts`) is a narrow interface —
`createPresignedPost`, `headObject` — that `attachments.service.ts` depends
on, not an `S3Client` directly, the same shape as `Cache`
([ADR-17](0017-cache-task-stats-with-explicit-invalidation.md)) and
`NotificationsQueue` ([ADR-16](0016-background-jobs-with-bullmq.md)). The
ordinary suite substitutes an in-memory fake
(`test/support.ts`'s `objectStore`) that never places anything in its
`uploads` map from `createPresignedPost` — a real presigned POST does not
touch the bucket either, only a later upload against the returned URL does.
Tests that need `confirm` to succeed call `simulateUpload` first, standing
in for that direct client-to-bucket request. `lib/s3.test.ts` is the
deliberate real-bucket exception, mirroring `lib/cache.test.ts`: it performs
an actual `fetch` POST against the presigned URL, against real MinIO, and
proves both that a compliant upload is accepted and that one violating the
signed content-type is rejected by the bucket itself.

Local development and CI run MinIO in Docker Compose rather than a real AWS
bucket. MinIO implements the same POST Policy API, so `createPresignedPost`
and its conditions work unchanged against it; only `S3_ENDPOINT` and
`S3_FORCE_PATH_STYLE` differ between environments, both empty/false in
production where the AWS SDK resolves the real endpoint and
virtual-hosted-style addressing applies.

`confirm` is an upsert on `key`, not a plain create. A presigned POST has no
way to be revoked after one use — nothing stops the same link being POSTed
to twice with two different files before it expires — so `confirm` can
legitimately be called more than once for the same key, each time
describing whatever the bucket currently has. A plain `create` would crash
on `key`'s unique constraint the second time, and worse, would crash
*after* the second upload already happened, leaving the row describing the
first file while the bucket holds the second. The upsert re-syncs the row
to the bucket's current state on every call instead, so `confirm` is safe
to call any number of times and the row can never drift from what the
bucket actually has.

## Consequences

**Rejected: `multer` with memory storage**, as originally planned. Buffering
every attachment through the app server's memory is the opposite of what a
stateless, horizontally-scaled API container wants under load, and gains
nothing here — the server was never going to inspect the bytes, only
relay them. Presigned POST also composes better with what Week 4 needs
anyway: an ECS task role scoped to this bucket, rather than the app server
holding a general-purpose write credential it uses on every upload.

**The client controls upload timing, not content.** Between presign and
confirm, a key exists that nothing may ever be uploaded to (abandoned by the
client), or that is uploaded to but never confirmed (abandoned after). Both
leave an orphaned object in the bucket with no application-visible failure
mode; neither is cleaned up by this change. A bucket lifecycle rule
expiring unconfirmed keys after a day would close this, and is deferred
until it costs more than a S3 storage rounding error — the same "is this
worth new infrastructure yet" judgment [ADR-17](0017-cache-task-stats-with-explicit-invalidation.md)
made about database-level cache invalidation.

**The key's prefix, not a `starts-with` policy condition, is what scopes an
upload to its task.** Because the server generates and signs the entire key
rather than a prefix the client completes, `createPresignedPost`'s default
behavior already binds the policy to that exact key — there is nothing a
`starts-with` condition would additionally restrict. `attachments.service.ts`
still checks the prefix again at confirm time, defensively: it is what
turns a caller presenting another organization's real, uploaded key into
the same 404 as a key nothing was ever uploaded to, rather than a 500 from
whatever downstream code assumed the prefix already held.

**Uploads are not virus-scanned or content-sniffed.** The content-type
condition is what the client's request claims, checked by the bucket
against the signed value — not an inspection of the bytes. A `.png` with a
`text/plain` first few bytes and a spoofed content-type header would still
satisfy `image/png` if the client lied consistently at both presign and
upload time. Out of scope at this stage; a future defense (S3 event →
Lambda scan, or a virus-scanning proxy) is deferred the same way rate
limiting on the presign endpoint itself is — both are Week 3 hardening, not
this feature specifically.
