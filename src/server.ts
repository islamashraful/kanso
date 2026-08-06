import { createApp } from '@/app';
import { config } from '@/config';
import { createDb } from '@/lib/db';

const db = createDb(config);
const app = createApp({ config, db });

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
    console.log('Shutdown complete');
    process.exit(0);
  });
};

process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  shutdown('SIGINT');
});
