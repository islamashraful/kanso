import { Router } from 'express';

import type { HealthService } from './health.service';

/**
 * Liveness and readiness, outside `/api/v1` and outside auth: the ALB target
 * group polling these has no credentials to send, and what it's asking isn't
 * tenant data.
 *
 * `/health` (liveness) never touches the database or Redis — it only proves
 * the process is running and answering requests. Wiring a dependency check
 * into it would let a slow database make ECS kill a container that would
 * otherwise recover on its own. `/health/ready` (readiness) is the one that
 * actually reaches Postgres and Redis, and is what decides whether a task
 * receives traffic.
 */
export const createHealthRouter = (health: HealthService): Router => {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  router.get('/health/ready', async (_req, res) => {
    const result = await health.checkReadiness();
    res.status(result.status === 'ok' ? 200 : 503).json(result);
  });

  return router;
};
