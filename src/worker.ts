import { createNotificationsWorker } from '@/jobs/notifications.worker';
import { config } from '@/config';
import { createConsoleEmailSender } from '@/lib/email';
import { createDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { createRedisConnection } from '@/lib/queue';

const db = createDb(config);
const connection = createRedisConnection(config);
const emailSender = createConsoleEmailSender();

const worker = createNotificationsWorker(connection, db, emailSender);

worker.on('completed', (job) => {
  logger.info({ jobId: job.id, jobName: job.name }, 'job completed');
});
worker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, jobName: job?.name, err }, 'job failed');
});

logger.info('notifications worker listening');

/**
 * Graceful shutdown, parallel to `server.ts`. `worker.close()` first: it
 * stops pulling new jobs and waits for the active one to finish, the same
 * way `server.close()` drains in-flight requests before the process exits.
 */
const SHUTDOWN_TIMEOUT_MS = 10_000;

const shutdown = (signal: string): void => {
  logger.info({ signal }, 'shutting down');

  const forceExit = setTimeout(() => {
    logger.error('shutdown timed out, exiting anyway');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  void worker
    .close()
    .then(() => connection.quit())
    .then(() => {
      logger.info('shutdown complete');
      process.exit(0);
    })
    .catch((err: unknown) => {
      logger.error({ err }, 'error during shutdown');
      process.exit(1);
    });
};

process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  shutdown('SIGINT');
});
