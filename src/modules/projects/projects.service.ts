import type { ProjectModel as Project } from '@/generated/prisma/models';
import type { Db } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';
import type { Page } from '@/lib/pagination';
import { toOrderBy, toPage, toSkipTake } from '@/lib/pagination';

import type { CreateProjectInput, ListProjectsQuery } from './projects.schema';

/**
 * Project business logic.
 *
 * Same shape as the tasks service, deliberately: every method takes
 * `organizationId` first and every query filters on it, so an unscoped query is
 * visually obvious in review. See docs/adr/0001 and docs/adr/0003.
 */
export const createProjectsService = (db: Db) => ({
  async list(organizationId: string, query: ListProjectsQuery): Promise<Page<Project>> {
    const where = { organizationId };

    // Rows and count in one interactive transaction at repeatable read, so
    // both see the same snapshot and the total describes the page it arrives
    // with. Same reasoning, and the same reason for the interactive form, as
    // the tasks service. See docs/adr/0014.
    const [projects, total] = await db.$transaction(
      async (tx) =>
        Promise.all([
          tx.project.findMany({
            where,
            orderBy: toOrderBy(query.sort, query.order),
            ...toSkipTake(query),
          }),
          tx.project.count({ where }),
        ]),
      { isolationLevel: 'RepeatableRead' },
    );

    return toPage(projects, total, query);
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

  async remove(organizationId: string, id: string): Promise<void> {
    // deleteMany scoped to both, rather than delete on the id: a delete would
    // remove another organization's project if the id were guessed, and the
    // count is what tells a miss from a success without a prior read.
    const { count } = await db.project.deleteMany({ where: { id, organizationId } });

    if (count === 0) throw new NotFoundError('Project not found');
  },
});

export type ProjectsService = ReturnType<typeof createProjectsService>;
