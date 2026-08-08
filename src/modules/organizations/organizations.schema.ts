import { z } from 'zod';

/**
 * The request contract for organizations. See docs/adr/0005.
 *
 * The slug is supplied rather than derived from the name. Deriving it would
 * still need a collision rule, and a generated `acme-2` is harder to explain
 * to the client than a 409 naming the one it asked for.
 */
export const createOrganizationSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  slug: z
    .string()
    .trim()
    .min(1, 'Slug is required')
    .max(60)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Lowercase letters, numbers and single hyphens only'),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
