import { createApp } from '@/app';
import { config } from '@/config';
import { createNotificationsQueue } from '@/jobs/notifications.job';
import { createRedisCache } from '@/lib/cache';
import { createDb } from '@/lib/db';
import { createRedisConnection } from '@/lib/queue';

const db = createDb(config);
const redis = createRedisConnection(config);
const notifications = createNotificationsQueue(redis);
const cache = createRedisCache(redis);
const app = createApp({ config, db, notifications, redis, cache });

const server = app.listen(config.PORT, () => {
  console.log(`kanso listening on http://localhost:${config.PORT} (${config.NODE_ENV})`);
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
  console.log(`${signal} received, shutting down`);

  const forceExit = setTimeout(() => {
    console.error('Shutdown timed out, exiting anyway');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  server.close((err) => {
    if (err) {
      console.error('Error during shutdown:', err);
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
        console.log('Shutdown complete');
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
