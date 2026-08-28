import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import request from 'supertest';

import { createApp } from '@/app';
import { config } from '@/config';
import { createNotificationsQueue } from '@/jobs/notifications.job';
import { createNotificationsWorker } from '@/jobs/notifications.worker';
import type { EmailSender } from '@/lib/email';
import { createRedisConnection } from '@/lib/queue';
import { asUser, db, resetDatabase, seed } from '@/test/support';

/**
 * The tests in this file talk to real Redis, proving the queue and worker
 * actually wire together rather than only asserting against the fake in
 * `test/support.ts`. Everything else about task assignment is tested
 * against that fake — see docs/adr/0016 for why this is the deliberate
 * exception to testing against the real thing (docs/adr/0009).
 */

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await resetDatabase();
});

describe('notifications worker', () => {
  it('processes a task-assigned job by sending an email', async () => {
    const fixtures = await seed();
    const task = await db.task.create({
      data: {
        organizationId: fixtures.acme.id,
        projectId: fixtures.acmeProject.id,
        title: 'Wire the worker',
      },
    });

    const sent: { to: string; subject: string; body: string }[] = [];
    const fakeEmailSender: EmailSender = {
      send(to, subject, body) {
        sent.push({ to, subject, body });
        return Promise.resolve();
      },
    };

    const queueConnection = createRedisConnection(config);
    const workerConnection = createRedisConnection(config);
    const queue = createNotificationsQueue(queueConnection);
    const worker = createNotificationsWorker(workerConnection, db, fakeEmailSender);

    try {
      const processed = new Promise<void>((resolve, reject) => {
        worker.on('completed', () => {
          resolve();
        });
        worker.on('failed', (_job, err) => {
          reject(err);
        });
      });

      await queue.enqueueTaskAssigned({ taskId: task.id, assigneeId: fixtures.ada.id });
      await processed;

      expect(sent).toEqual([
        {
          to: fixtures.ada.email,
          subject: "You've been assigned: Wire the worker",
          body: `Hi ${fixtures.ada.name}, you've been assigned the task "Wire the worker".`,
        },
      ]);
    } finally {
      await worker.close();
      await queue.close();
      await queueConnection.quit();
      await workerConnection.quit();
    }
  });

  /**
   * Everywhere else, "task assignment" and "the worker" are proven correct
   * separately — one against a fake queue, one by enqueuing a job directly.
   * Neither proves the two halves agree with each other at runtime: a wrong
   * queue name or a mismatched job name would pass both and still never
   * deliver a real notification. This test is the seam: the real HTTP
   * endpoint, a real queue, and a real worker, with only the email send
   * faked. See docs/adr/0016.
   */
  it('sends a notification when a task is assigned through the real API', async () => {
    const fixtures = await seed();
    const task = await db.task.create({
      data: {
        organizationId: fixtures.acme.id,
        projectId: fixtures.acmeProject.id,
        title: 'Prove the wiring',
      },
    });

    const sent: { to: string; subject: string; body: string }[] = [];
    const fakeEmailSender: EmailSender = {
      send(to, subject, body) {
        sent.push({ to, subject, body });
        return Promise.resolve();
      },
    };

    const queueConnection = createRedisConnection(config);
    const workerConnection = createRedisConnection(config);
    const notifications = createNotificationsQueue(queueConnection);
    const worker = createNotificationsWorker(workerConnection, db, fakeEmailSender);
    const app = createApp({ config, db, notifications, redis: queueConnection });

    try {
      const processed = new Promise<void>((resolve, reject) => {
        worker.on('completed', () => {
          resolve();
        });
        worker.on('failed', (_job, err) => {
          reject(err);
        });
      });

      const res = await request(app)
        .post(`/api/v1/tasks/${task.id}/assign`)
        .set(asUser(fixtures.ada, fixtures.acme.id))
        .send({ assigneeId: fixtures.ada.id });

      expect(res.status).toBe(200);

      await processed;

      expect(sent).toEqual([
        {
          to: fixtures.ada.email,
          subject: "You've been assigned: Prove the wiring",
          body: `Hi ${fixtures.ada.name}, you've been assigned the task "Prove the wiring".`,
        },
      ]);
    } finally {
      await worker.close();
      await notifications.close();
      await queueConnection.quit();
      await workerConnection.quit();
    }
  });
});
