import { Router } from 'express';

import { validate } from '@/middleware/validate';

import { createAuthController } from './auth.controller';
import { loginSchema, refreshSchema, registerSchema } from './auth.schema';
import type { AuthService } from './auth.service';

/**
 * Declares paths, attaches middleware, delegates. No logic.
 *
 * Unlike every other router, this one is mounted without `requireAuth`: these
 * are the endpoints a caller uses to obtain credentials, so requiring them
 * would be circular.
 */
export const createAuthRouter = (auth: AuthService): Router => {
  const controller = createAuthController(auth);
  const router = Router();

  router.post('/register', validate({ body: registerSchema }), controller.register);
  router.post('/login', validate({ body: loginSchema }), controller.login);
  router.post('/refresh', validate({ body: refreshSchema }), controller.refresh);
  router.post('/logout', validate({ body: refreshSchema }), controller.logout);

  return router;
};
