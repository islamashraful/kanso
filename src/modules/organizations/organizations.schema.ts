import { z } from 'zod';

import type { OrganizationModel as Organization } from '@/generated/prisma/models';
import type { Serialized } from '@/lib/serialized';

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

export const organizationResponseSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    slug: z.string(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: 'Organization' });

/**
 * What `GET /organizations` returns: the organization plus the caller's own
 * role in it. The role lives on the membership, never on the user, so it is
 * only meaningful alongside the organization it was read with. See
 * docs/adr/0013.
 */
export const organizationMembershipResponseSchema = organizationResponseSchema
  .extend({
    role: z.enum(['OWNER', 'ADMIN', 'MEMBER']),
  })
  .meta({ id: 'OrganizationMembership' });

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type OrganizationResponse = z.infer<typeof organizationResponseSchema>;

/*
 * Pins the documented response to the Prisma model. Neither line runs: each is
 * an assignability assertion written as a function, and together they fail
 * `bun run typecheck` if the two shapes differ in either direction — a field
 * invented here, or a column added to the model and never documented. Unlike
 * the request schemas above, this one is not a validator, so nothing else
 * would notice it drifting. See lib/serialized.ts for the full reasoning.
 */
const _matchesModel = (org: Serialized<Organization>): OrganizationResponse => org;
const _matchesSchema = (org: OrganizationResponse): Serialized<Organization> => org;
void _matchesModel;
void _matchesSchema;
