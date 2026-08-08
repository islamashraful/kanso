import type { ProjectModel as Project } from '@/generated/prisma/models';
import type { Db } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';

import type { CreateProjectInput } from './projects.schema';

/**
 * Project business logic.
 *
 * Same shape as the tasks service, deliberately: every method takes
 * `organizationId` first and every query filters on it, so an unscoped query is
 * visually obvious in review. See docs/adr/0001 and docs/adr/0003.
 */
export const createProjectsService = (db: Db) => ({
  async list(organizationId: string): Promise<Project[]> {
    return db.project.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
  },

  async getById(organizationId: string, id: string): Promise<Project> {
    const project = await db.project.findFirst({ where: { id, organizationId } });

    // findFirst with both conditions, not findUnique on id alone: a project
    // belonging to another organization must be indistinguishable from one
    // that does not exist.
    if (!project) throw new NotFoundError('Project not found');

    return project;
  },

  async create(organizationId: string, input: CreateProjectInput): Promise<Project> {
    return db.project.create({
      data: { organizationId, name: input.name },
    });
  },
});

export type ProjectsService = ReturnType<typeof createProjectsService>;
