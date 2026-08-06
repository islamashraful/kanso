import type { RequestHandler } from 'express';

import { NotFoundError } from '@/lib/errors';

/**
 * Mounted after every route. Turns an unmatched path into the same error shape
 * as everything else, instead of Express's default HTML response.
 */
export const notFound: RequestHandler = (req, _res, next) => {
  next(new NotFoundError(`Cannot ${req.method} ${req.path}`));
};
