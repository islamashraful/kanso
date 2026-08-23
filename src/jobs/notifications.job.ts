import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';

export const NOTIFICATIONS_QUEUE_NAME = 'notifications';

/**
 * The job carries ids, not a denormalized snapshot: the worker looks up the
 * task and assignee fresh when it runs, so a title or email changed between
 * enqueue and processing is never sent stale.
 */
export interface TaskAssignedJobData {
  taskId: string;
  assigneeId: string;
}

/**
 * The narrow interface `tasks.service.ts` actually depends on, rather than
 * a raw BullMQ `Queue`. That's what a test fake implements to assert a job
 * was enqueued without needing a real Redis connection. See docs/adr/0016.
 *
 * Synchronous handoff, asynchronous execution: awaiting this call only
 * confirms the job reached Redis, in milliseconds. It does not wait for the
 * job to run — that happens later, in the worker process.
 */
export interface NotificationsQueue {
  enqueueTaskAssigned(data: TaskAssignedJobData): Promise<void>;
}

export const createNotificationsQueue = (
  connection: Redis,
): NotificationsQueue & { close(): Promise<void> } => {
  const queue = new Queue<TaskAssignedJobData>(NOTIFICATIONS_QUEUE_NAME, { connection });

  return {
    async enqueueTaskAssigned(data) {
      await queue.add('task-assigned', data);
    },
    close: () => queue.close(),
  };
};
