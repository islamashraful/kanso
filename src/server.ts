import { createApp } from '@/app';
import { config } from '@/config';
import { createNotificationsQueue } from '@/jobs/notifications.job';
import { createRedisCache } from '@/lib/cache';
import { createDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { createRedisConnection } from '@/lib/queue';
import { createS3Client, createS3ObjectStore } from '@/lib/s3';

const db = createDb(config);
const redis = createRedisConnection(config);
const notifications = createNotificationsQueue(redis);
const cache = createRedisCache(redis);
const objectStore = createS3ObjectStore(createS3Client(config), config.S3_BUCKET);
const app = createApp({ config, db, notifications, redis, cache, objectStore, redisClient: redis });

const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT, env: config.NODE_ENV }, 'kanso listening');
});

/**
 * Graceful shutdown.
 *
 * ECS sends SIGTERM before stopping a task during every deploy. Closing the
 * server stops it accepting new connections while letting in-flight requests
 * finish, so a rolling deploy drops nothing. The timeout is the backstop for a
 * request that never completes.
 */
const SHUTDOWN_TIMEOUT_MS = 10_000;

const shutdown = (signal: string): void => {
  logger.info({ signal }, 'shutting down');

  const forceExit = setTimeout(() => {
    logger.error('shutdown timed out, exiting anyway');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  server.close((err) => {
    if (err) {
      logger.error({ err }, 'error during shutdown');
      process.exit(1);
    }

    // After the server stops accepting requests, not before: an in-flight
    // request may still need the database or the queue to finish.
    //
    // The queue closes before the connection it was given: it's a shared
    // connection, so BullMQ doesn't quit it on close, but it may still send
    // a final command while shutting down.
    void notifications
      .close()
      .then(() => Promise.all([db.$disconnect(), redis.quit()]))
      .then(() => {
        logger.info('shutdown complete');
        process.exit(0);
      });
  });
};

process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  shutdown('SIGINT');
});
