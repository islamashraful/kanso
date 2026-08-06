import type { ErrorRequestHandler } from 'express';

import type { Config } from '@/config';
import { AppError, ValidationError } from '@/lib/errors';

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: { path: string; message: string }[];
    stack?: string;
  };
}

/**
 * The single error handler, mounted last.
 *
 * Express only recognises a handler as error middleware if it declares exactly
 * four parameters, which is why `_next` is present but unused. Every failure in
 * the application routes through here, so the response shape is uniform and
 * cross-cutting concerns (logging, reporting) attach in one place.
 */
export const createErrorHandler = (config: Config): ErrorRequestHandler => {
  const isProduction = config.NODE_ENV === 'production';

  return (err, _req, res, _next) => {
    if (err instanceof AppError) {
      const body: ErrorBody = { error: { code: err.code, message: err.message } };
      if (err instanceof ValidationError) {
        body.error.details = err.details;
      }
      res.status(err.status).json(body);
      return;
    }

    // Not an anticipated failure: log it in full, tell the client nothing.
    console.error('Unhandled error:', err);

    const body: ErrorBody = {
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    };
    if (!isProduction && err instanceof Error) {
      body.error.stack = err.stack;
    }
    res.status(500).json(body);
  };
};
