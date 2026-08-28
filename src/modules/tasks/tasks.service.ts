import type { TaskModel as Task } from '@/generated/prisma/models';
import type { NotificationsQueue } from '@/jobs/notifications.job';
import type { Cache } from '@/lib/cache';
import type { Db } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';
import type { Page } from '@/lib/pagination';
import { toOrderBy, toPage, toSkipTake } from '@/lib/pagination';

import type {
  CreateTaskInput,
  ListTasksQuery,
  TaskStatsResponse,
  UpdateTaskStatusInput,
} from './tasks.schema';

/**
 * One key per organization: stats are computed across all of an org's tasks,
 * not per project, so that's the only thing the key needs to name. See
 * docs/adr/0017.
 *
 * Exported, not private to this module: deleting a project cascades to its
 * tasks and changes what this key describes, so `projects.service.ts` needs
 * the same key to invalidate it. See docs/adr/0017's "Known gap" section.
 */
export const statsCacheKey = (organizationId: string) => `stats:tasks:${organizationId}`;

/**
 * A backstop against a missed invalidation, not the freshness mechanism —
 * every write that changes the counts below explicitly deletes the key. See
 * docs/adr/0017.
 */
const STATS_CACHE_TTL_SECONDS = 300;

/**
 * Task business logic.
 *
 * Knows nothing about HTTP: no `req`, no `res`, no status codes. It takes plain
 * arguments, returns plain data, and throws AppError subclasses. The db client
 * arrives as an argument rather than an import, so tests can substitute it.
 * See docs/adr/0001 and docs/adr/0003.
 *
 * Every method takes `organizationId` first and every query filters on it. That
 * repetition is deliberate: it makes an unscoped query visually obvious in
 * review, which is the failure that would leak one tenant's data to another.
 */
export const createTasksService = (db: Db, notifications: NotificationsQueue, cache: Cache) => ({
  async list(organizationId: string, query: ListTasksQuery): Promise<Page<Task>> {
    const where = {
      organizationId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.projectId ? { projectId: query.projectId } : {}),
    };

    // One transaction at repeatable read, so the total describes the page it
    // arrives with. The isolation level is the part that matters: at Postgres's
    // default, read committed, each statement takes its own snapshot and a
    // write landing between them yields a count that contradicts the rows.
    //
    // Interactive rather than the array form, which accepts `isolationLevel`
    // and drops it — the transaction opens at read committed regardless. See
    // docs/adr/0014.
    const [tasks, total] = await db.$transaction(
      async (tx) =>
        Promise.all([
          tx.task.findMany({
            where,
            orderBy: toOrderBy(query.sort, query.order),
            ...toSkipTake(query),
          }),
          tx.task.count({ where }),
        ]),
      { isolationLevel: 'RepeatableRead' },
    );

    return toPage(tasks, total, query);
  },

  async getById(organizationId: string, id: string): Promise<Task> {
    const task = await db.task.findFirst({ where: { id, organizationId } });

    // findFirst with both conditions, not findUnique on id alone: a task
    // belonging to another organization must be indistinguishable from one
    // that does not exist, or the 404-vs-403 difference leaks its existence.
    if (!task) throw new NotFoundError('Task not found');

    return task;
  },

  async create(organizationId: string, input: CreateTaskInput): Promise<Task> {
    // The composite foreign key is what guarantees a task and its project
    // agree (docs/adr/0010), but it reports a mismatch as a constraint
    // violation, which reaches the client as a 500. Looking the project up
    // first turns the ordinary case — a wrong or foreign project id — into a
    // 404. It shapes the error; it is not the guarantee.
    const project = await db.project.findFirst({
      where: { id: input.projectId, organizationId },
      select: { id: true },
    });

    if (!project) throw new NotFoundError('Project not found');

    const task = await db.task.create({
      data: {
        organizationId,
        projectId: input.projectId,
        title: input.title,
        status: input.status,
      },
    });

    // A new task changes both `total` and the count for its starting status.
    await cache.del(statsCacheKey(organizationId));

    return task;
  },

  /**
   * The only endpoint that moves a task between statuses, which makes it the
   * other write `stats` has to invalidate against — creation changes `total`,
   * this changes the distribution across it. See docs/adr/0017.
   */
  async updateStatus(
    organizationId: string,
    id: string,
    status: UpdateTaskStatusInput['status'],
  ): Promise<Task> {
    const task = await db.task.findFirst({ where: { id, organizationId }, select: { id: true } });
    if (!task) throw new NotFoundError('Task not found');

    const updated = await db.task.update({ where: { id }, data: { status } });
    await cache.del(statsCacheKey(organizationId));

    return updated;
  },

  /**
   * Task counts by status and the completion rate they imply, cached behind
   * `statsCacheKey` rather than recomputed on every request. The TTL is a
   * backstop; `create` and `updateStatus` are what actually keep this fresh,
   * by deleting the key the moment either changes the numbers. See
   * docs/adr/0017.
   */
  async stats(organizationId: string): Promise<TaskStatsResponse> {
    const key = statsCacheKey(organizationId);
    const cached = await cache.get(key);
    if (cached) return JSON.parse(cached) as TaskStatsResponse;

    const counts = await db.task.groupBy({
      by: ['status'],
      where: { organizationId },
      _count: true,
    });

    const byStatus = { OPEN: 0, IN_PROGRESS: 0, DONE: 0 };
    for (const row of counts) byStatus[row.status] = row._count;

    const total = byStatus.OPEN + byStatus.IN_PROGRESS + byStatus.DONE;
    const completionRate = total === 0 ? 0 : Math.round((byStatus.DONE / total) * 100);
    const stats: TaskStatsResponse = { total, byStatus, completionRate };

    await cache.set(key, JSON.stringify(stats), STATS_CACHE_TTL_SECONDS);

    return stats;
  },

  /**
   * Assign a task to a member of the same organization, and enqueue the
   * notification job. Both lookups are proactive — the same style as
   * `create`'s project check — rather than catching the constraint the
   * composite `assignee` FK on `Task` enforces underneath this. See
   * docs/adr/0016.
   */
  async assign(organizationId: string, id: string, assigneeId: string): Promise<Task> {
    const task = await db.task.findFirst({ where: { id, organizationId }, select: { id: true } });
    if (!task) throw new NotFoundError('Task not found');

    const membership = await db.membership.findUnique({
      where: { userId_organizationId: { userId: assigneeId, organizationId } },
      select: { userId: true },
    });
    if (!membership) throw new NotFoundError('Member not found in this organization');

    const updated = await db.task.update({ where: { id }, data: { assigneeId } });
    await notifications.enqueueTaskAssigned({ taskId: updated.id, assigneeId });

    return updated;
  },
});

export type TasksService = ReturnType<typeof createTasksService>;
