import { createNotificationsWorker } from '@/jobs/notifications.worker';
import { config } from '@/config';
import { createConsoleEmailSender } from '@/lib/email';
import { createDb } from '@/lib/db';
import { createRedisConnection } from '@/lib/queue';

const db = createDb(config);
const connection = createRedisConnection(config);
const emailSender = createConsoleEmailSender();

const worker = createNotificationsWorker(connection, db, emailSender);

worker.on('completed', (job) => {
  console.log(`job ${job.id} (${job.name}) completed`);
});
worker.on('failed', (job, err) => {
  console.error(`job ${job?.id} (${job?.name}) failed:`, err);
});

console.log('notifications worker listening');

/**
 * Graceful shutdown, parallel to `server.ts`. `worker.close()` first: it
 * stops pulling new jobs and waits for the active one to finish, the same
 * way `server.close()` drains in-flight requests before the process exits.
 */
const SHUTDOWN_TIMEOUT_MS = 10_000;

const shutdown = (signal: string): void => {
  console.log(`${signal} received, shutting down`);

  const forceExit = setTimeout(() => {
    console.error('Shutdown timed out, exiting anyway');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  void worker
    .close()
    .then(() => connection.quit())
    .then(() => {
      console.log('Shutdown complete');
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error('Error during shutdown:', err);
      process.exit(1);
    });
};

process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  shutdown('SIGINT');
});
