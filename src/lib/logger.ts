import pino from 'pino';

import { config } from '@/config';

export type Logger = pino.Logger;

/**
 * The base logger. Writes structured JSON to stdout, which is what a
 * container runtime (and later, CloudWatch via the `awslogs` driver) captures
 * without any further wiring — see docs/architecture.md.
 *
 * Silenced under `bun test`: the ordinary suite asserts against HTTP
 * responses, and per-request log lines would just be noise in the runner's
 * output.
 */
export const logger: Logger = pino({
  level: config.NODE_ENV === 'test' ? 'silent' : 'info',
});
