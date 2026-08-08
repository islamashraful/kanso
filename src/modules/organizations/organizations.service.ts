import type { Role } from '@/generated/prisma/enums';
import type { OrganizationModel as Organization } from '@/generated/prisma/models';
import { Prisma } from '@/generated/prisma/client';
import type { Db } from '@/lib/db';
import { ConflictError } from '@/lib/errors';

import type { CreateOrganizationInput } from './organizations.schema';

/**
 * The project every new organization starts with, so the first task has
 * somewhere to go. See docs/adr/0012.
 */
const DEFAULT_PROJECT_NAME = 'General';

export interface OrganizationMembership extends Organization {
  role: Role;
}

/**
 * Organization business logic.
 *
 * The one service that does not take `organizationId` first, because these are
 * the endpoints that run before the caller has an organization to be scoped
 * to. Scoping here is by user: a caller sees an organization only through a
 * membership row of their own.
 */
export const createOrganizationsService = (db: Db) => ({
  async listForUser(userId: string): Promise<OrganizationMembership[]> {
    const memberships = await db.membership.findMany({
      where: { userId },
      include: { organization: true },
      orderBy: { createdAt: 'desc' },
    });

    return memberships.map(({ organization, role }) => ({ ...organization, role }));
  },

  /**
   * Create an organization, its owner membership and its first project.
   *
   * All three or none: an organization written without a membership is
   * unreachable, since every read of one goes through a membership row. See
   * docs/adr/0012.
   */
  async create(userId: string, input: CreateOrganizationInput): Promise<Organization> {
    try {
      return await db.$transaction(async (tx) => {
        // Interactive rather than the array form used for token rotation: the
        // membership and the project both need an id that does not exist
        // until this first write returns.
        const organization = await tx.organization.create({
          data: { name: input.name, slug: input.slug },
        });

        await tx.membership.create({
          data: { userId, organizationId: organization.id, role: 'OWNER' },
        });

        await tx.project.create({
          data: { organizationId: organization.id, name: DEFAULT_PROJECT_NAME },
        });

        return organization;
      });
    } catch (error) {
      // The slug is unique, and a taken one is an ordinary client mistake
      // rather than a bug. Left unhandled it would reach the error middleware
      // as a 500 (docs/adr/0006). The transaction has already rolled back by
      // the time this runs.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError('Organization slug already taken');
      }

      throw error;
    }
  },
});

export type OrganizationsService = ReturnType<typeof createOrganizationsService>;
