import { z } from 'zod';

/**
 * Offset pagination, shared by every paginated collection. See docs/adr/0014.
 *
 * Composed into a module's query schema rather than restated per endpoint: a
 * default that differed between two list endpoints would be a surprise, and
 * the cap on `limit` has to hold everywhere or it holds nowhere.
 */

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

/**
 * Query strings are always strings, so both fields coerce. `page` and `limit`
 * are the whole contract; the sort key is not here because the set of columns
 * a caller may order by is per module.
 */
export const paginationSchema = z.object({
  page: z.coerce
    .number('Page must be a number')
    .int('Page must be a whole number')
    .min(1, 'Page starts at 1')
    .default(1),
  limit: z.coerce
    .number('Limit must be a number')
    .int('Limit must be a whole number')
    .min(1, 'Limit must be at least 1')
    .max(MAX_LIMIT, `Limit cannot exceed ${MAX_LIMIT}`)
    .default(DEFAULT_LIMIT),
});

export type PaginationQuery = z.infer<typeof paginationSchema>;

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

/**
 * The envelope. `data` is the part that survives a change of mechanism:
 * moving to cursors later replaces the contents of `meta` and leaves the rows
 * where every client already reads them.
 */
export interface Page<T> {
  data: T[];
  meta: PageMeta;
}

/** Prisma's arguments for a page. */
export const toSkipTake = ({ page, limit }: PaginationQuery) => ({
  skip: (page - 1) * limit,
  take: limit,
});

/**
 * The requested ordering, with `id` appended as a tiebreaker.
 *
 * Without it the ordering is not total, and offset pagination requires that it
 * is. Prisma maps DateTime to `timestamp(3)`, so two rows written in the same
 * millisecond tie on `createdAt`, and Postgres may order tied rows differently
 * between the page query and the next one — putting the same row on two pages
 * and dropping another entirely. `id` is `uuid(7)`, which is time-ordered, so
 * it breaks the tie in the same direction the caller asked for.
 */
export const toOrderBy = <TField extends string>(sort: TField, order: 'asc' | 'desc') => [
  { [sort]: order },
  { id: order },
];

export const toPage = <T>(data: T[], total: number, { page, limit }: PaginationQuery): Page<T> => {
  // An empty collection is one empty page, not zero pages, so a client
  // rendering "page 1 of n" never shows "page 1 of 0".
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return {
    data,
    meta: {
      page,
      limit,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrevious: page > 1,
    },
  };
};
