/**
 * What a value looks like after `res.json()` has been through it, and the
 * machinery for checking a response schema against the model it describes.
 *
 * ## The problem
 *
 * Request schemas cannot lie. `createTaskSchema` *is* the validator, so a
 * request the document describes is a request the API accepts — there is one
 * definition and it is enforced at runtime.
 *
 * Response schemas have no such anchor. What leaves a service is a Prisma row,
 * not a parsed Zod value, so `taskResponseSchema` is a hand-written claim
 * about a shape nothing checks it against. Add a column to the Prisma model
 * and the documented response is silently incomplete: the API returns a field
 * the reference never mentions, and no test fails, because the schema is only
 * ever read by the document generator. That is the exact failure mode
 * generating from Zod exists to prevent, reappearing on the response side.
 *
 * ## The check
 *
 * Each module pins its response schema to its model with two declarations:
 *
 *   const _matchesModel = (task: Serialized<Task>): TaskResponse => task;
 *   const _matchesSchema = (task: TaskResponse): Serialized<Task> => task;
 *
 * Neither ever runs, and neither is meant to. They are assignability
 * assertions written as functions, because a function signature is the
 * shortest way to make the compiler compare two types.
 *
 * The first says a Prisma row must be assignable to the documented shape,
 * which fails if the schema requires a field the model does not have. The
 * second says the documented shape must be assignable to a Prisma row, which
 * fails if the model has a field the schema never documented. Either direction
 * alone permits one kind of drift; together they mean the two are exactly
 * equal, and `bun run typecheck` is where a mismatch shows up.
 *
 * The `void` line after each is not part of the check. It only tells the
 * linter the binding is used on purpose.
 *
 * ## Why the type is needed at all
 *
 * The two shapes cannot be compared directly. Prisma types `createdAt` as
 * `Date`; by the time Express has serialized the response it is an ISO 8601
 * string, which is what the schema documents. Comparing `Date` to `string`
 * would fail on every model for a reason that has nothing to do with drift.
 *
 * `Serialized<T>` closes that gap by rewriting every `Date` in a type to
 * `string`, leaving everything else alone — so what gets compared is the model
 * as the client receives it, rather than as Prisma holds it.
 *
 * It handles `Date` and `Date | null`, which is every date-shaped field in the
 * schema today. A nested object holding a `Date` would pass through unchanged
 * and go unchecked; no model has one, and the fix if one appears is to make
 * this recursive.
 */
export type Serialized<T> = {
  [K in keyof T]: T[K] extends Date ? string : T[K] extends Date | null ? string | null : T[K];
};
