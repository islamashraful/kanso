import { apiReference } from '@scalar/express-api-reference';
import { Router } from 'express';

import { buildOpenApiDocument } from './document';

export const SPEC_PATH = '/openapi.json';
export const REFERENCE_PATH = '/reference';

/**
 * Serves the spec and the reference that renders it.
 *
 * The document is built once, at wiring time, not per request: it is derived
 * from schemas that cannot change while the process runs, and rebuilding it on
 * every request would walk every schema in the application to produce the same
 * bytes.
 *
 * Both routes sit outside `/api/v1` and outside `requireAuth`. The spec
 * describes the shape of the API, not any tenant's data, and a reference no
 * one can open documents nothing. See docs/adr/0015.
 */
export const createOpenApiRouter = (): Router => {
  const document = buildOpenApiDocument();
  const router = Router();

  router.get(SPEC_PATH, (_req, res) => {
    res.json(document);
  });

  router.use(
    REFERENCE_PATH,
    apiReference({
      url: SPEC_PATH,
      pageTitle: 'Kanso API reference',
    }),
  );

  return router;
};
