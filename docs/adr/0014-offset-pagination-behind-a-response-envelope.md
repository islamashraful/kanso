# 14. Paginate by offset, behind a response envelope

Date: 2026-08-09
Status: Accepted

## Context

`GET /tasks` returns every task in the organization. It filters by status and
project, but a caller cannot ask for less than all of it, and the response
grows without bound as an organization is used. The list endpoints are also
the ones the OpenAPI reference will document first, so their shape is about
to become a published contract.

Two mechanisms answer "give me the next twenty".

**Offset.** The caller names a page; the query is `LIMIT`/`OFFSET`. Any page
is reachable directly, a total count comes back with it, and a client can
render numbered page links. It has two known failures. Rows inserted or
deleted between requests shift the window, so an item can be seen twice or
skipped entirely while paging. And `OFFSET n` requires the database to walk
and discard n rows, so deep pages get progressively slower — the cost is in
the offset, not the page size.

**Cursor.** The caller passes an opaque marker denoting the last row seen, and
the query is a range read on an indexed ordering key. It has neither failure:
the window is anchored to a row rather than a position, and the read starts at
an index seek regardless of depth. What it gives up is arbitrary access —
there is no page 7 without walking to it — and a total count, which no longer
falls out of the query.

The pressure that makes cursor correct is scale and continuous insertion: an
activity feed, an audit log, an export walking a large table. Neither applies
here. Tasks belong to one organization, the collection is small enough that no
page is deep, and the interface a task list wants is the one offset provides —
page numbers and a total.

The second decision is what the response looks like. Returning a bare array
leaves nowhere to put the total, and adding one later would change the
response shape of an endpoint that is about to be documented.

## Decision

Use offset pagination. Accept `page` and `limit` as query parameters, defaults
1 and 20, with `limit` capped at 100. The cap is the point: an uncapped
`limit` is the same unbounded response this exists to remove, one query
parameter away.

Return every paginated collection as `{ data, meta }`, where `meta` carries
`page`, `limit`, `total`, `totalPages`, `hasNext` and `hasPrevious`. The
envelope is the part that survives a change of mechanism. Moving to cursors
later replaces the contents of `meta` and leaves `data` where every client
already reads it.

Sorting is a closed set. `sort` accepts only column names named in a Zod enum,
`order` only `asc` or `desc`. A sort key taken from the query string and
passed to `orderBy` unchecked is how a caller reaches a column the API never
meant to expose — and here the enum also makes the sortable surface a typed
thing rather than a convention.

Append `id` to every ordering. Offset pagination requires a total order, and
none of the sort keys provide one: Prisma maps `DateTime` to `timestamp(3)`,
so two rows written in the same millisecond tie on `createdAt`, and titles and
statuses tie freely. Postgres leaves the order of tied rows unspecified, so
two queries for two pages may order them differently — the same row on both
pages, another dropped. `id` is `uuid(7)` and time-ordered, so it breaks ties
in the direction the caller asked for.

Read the rows and the count in one transaction at repeatable read. Two
separate queries can be interleaved with a write, which returns a total that
does not describe the page returned alongside it — a small inconsistency, and
an avoidable one.

The isolation level is the part that fixes it, not the transaction. Prisma
sends no `SET TRANSACTION ISOLATION LEVEL` unless one is asked for, so a plain
`$transaction` runs at Postgres's default, read committed, where every
statement takes its own snapshot and the write lands between the two reads
exactly as it would outside a transaction. Repeatable read pins the snapshot
at the first statement.

Raising the isolation level is normally a decision with a price — repeatable
read is what makes Postgres abort a transaction that cannot be serialized,
which means application code that catches the abort and retries. That price is
not owed here. Postgres raises serialization failures on writes, and this
transaction only reads, so there is no failure to catch and no retry path to
build. The stronger guarantee arrives for the cost of one argument.

Use the interactive form to get it. The array form accepts an `isolationLevel`
and does not apply it — asking for `RepeatableRead` or `Serializable`, or
setting either as the client-wide `transactionOptions` default, still opens
the transaction at read committed, which `SHOW transaction_isolation` inside
it reports. The interactive form applies it. That is a silent difference
between two calls that read as equivalent, which is why the services carry a
comment saying so rather than only a link here.

Apply this to the organization-scoped collections, tasks and projects.
`GET /organizations` stays a bare array: it is bounded by the caller's own
memberships rather than by tenant activity, and a person belonging to enough
organizations to need paging is not a case this system has.

## Consequences

The interactive transaction holds a pooled connection across both queries
rather than letting them pipeline, and it is subject to a transaction timeout
the array form does not impose. For two index reads already cut to one
organization that is a couple of milliseconds, and the connection is the thing
to watch rather than the time: every list request now occupies one for the
length of two round trips, which is a pool question at high concurrency and
not a query question. It is the reason this shape belongs on list endpoints
and not on every pair of reads that happen to sit next to each other.

The two failures of offset are inherited, not solved. Paging while another
client inserts can repeat or skip a row, and there is no fix within this
mechanism — the shifting window is what an offset means. The condition that
forces cursors is a collection that grows continuously and is read in full:
the activity feed that arrives with the WebSocket work is the likely first
one, and it can adopt cursors on its own without disturbing these endpoints,
since the envelope is shared and the mechanism is not.

The tiebreaker is reasoned, not pinned by a test. It was added after a page
overlap appeared in the suite — eight rows across two pages, seven distinct —
but that failure depended on two inserts landing in the same millisecond, and
forcing the tie deliberately does not reproduce it: Postgres returns tied rows
in the same order for two identical queries often enough that a test asserting
otherwise passes with the tiebreaker removed. The guarantee being relied on is
that the ordering is total, which is checkable by reading the query and not by
running it.

`sort` accepts `title` and `status`, neither of which is indexed. Postgres
sorts them after the tenant filter has already cut the set to one
organization, so the sort is over a small result rather than the table. That
holds while organizations are small; the fix, if it stops holding, is an index
per sort key, and the closed enum is what makes the list of them knowable.

Counting on every request is a second query. `count` over a tenant-filtered
index is cheap at this size and would not stay cheap at millions of rows per
organization, where the usual answers are an approximate count or dropping
`total` from `meta`. Neither is worth doing now.

Existing clients of `GET /tasks` and `GET /projects` break: the response is an
object, not an array. There are none outside the test suite, which is the
reason to do this before the OpenAPI reference exists
([ADR-5](0005-zod-as-single-source-of-truth.md)) rather than after — a
documented shape is one that has to be versioned to change.

The pagination schema and the envelope live in `src/lib/pagination.ts` and are
composed into each module's query schema, rather than each module restating
the parameters. A default that differed per endpoint would be a surprise, and
the cap has to hold everywhere or it holds nowhere.
