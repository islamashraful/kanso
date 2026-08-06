import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';

import { ValidationError } from '@/lib/errors';

interface Schemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

/**
 * Validates the request against Zod schemas and stores the parsed result on
 * `req.validated`.
 *
 * Parsed output does not overwrite `req.body`/`req.query`/`req.params`: in
 * Express 5 `req.query` is a getter with no setter, so assigning to it throws.
 * Handlers read `req.validated`, which is also where type coercion has already
 * happened (query strings are always strings until Zod coerces them).
 */
export const validate = (schemas: Schemas): RequestHandler => {
  return (req, _res, next) => {
    const validated: NonNullable<typeof req.validated> = {};
    const details: { path: string; message: string }[] = [];

    for (const key of ['body', 'query', 'params'] as const) {
      const schema = schemas[key];
      if (!schema) continue;

      const result = schema.safeParse(req[key]);
      if (result.success) {
        validated[key] = result.data;
      } else {
        for (const issue of result.error.issues) {
          details.push({
            path: [key, ...issue.path.map(String)].join('.'),
            message: issue.message,
          });
        }
      }
    }

    if (details.length > 0) {
      throw new ValidationError(details);
    }

    req.validated = validated;
    next();
  };
};
