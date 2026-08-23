import { Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';

import type { Db } from '@/lib/db';
import type { EmailSender } from '@/lib/email';

import { NOTIFICATIONS_QUEUE_NAME, type TaskAssignedJobData } from './notifications.job';

/**
 * Consumes the notifications queue. Runs in `src/worker.ts`, a separate
 * process from the API, sharing the same `Db` and nothing else — it looks
 * up the task and assignee itself rather than trusting the job payload
 * beyond their ids. See docs/adr/0016.
 */
export const createNotificationsWorker = (
  connection: Redis,
  db: Db,
  emailSender: EmailSender,
): Worker<TaskAssignedJobData> => {
  const processTaskAssigned = async (data: TaskAssignedJobData) => {
    const [task, assignee] = await Promise.all([
      db.task.findUnique({ where: { id: data.taskId }, select: { title: true } }),
      db.user.findUnique({ where: { id: data.assigneeId }, select: { email: true, name: true } }),
    ]);

    // Either can be gone by the time this runs — the task deleted, the
    // membership removed since. Nothing to send, and not a failure worth
    // retrying.
    if (!task || !assignee) return;

    await emailSender.send(
      assignee.email,
      `You've been assigned: ${task.title}`,
      `Hi ${assignee.name}, you've been assigned the task "${task.title}".`,
    );
  };

  return new Worker<TaskAssignedJobData>(
    NOTIFICATIONS_QUEUE_NAME,
    async (job: Job<TaskAssignedJobData>) => {
      if (job.name === 'task-assigned') {
        await processTaskAssigned(job.data);
      }
    },
    { connection },
  );
};
