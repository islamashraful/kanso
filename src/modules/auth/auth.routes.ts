import { Router, type RequestHandler } from 'express';

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
 *
 * `loginLimiter` applies to `/login` only — brute-forcing a password is a
 * risk specific to that one endpoint, not registration or refresh. See
 * docs/adr/0020.
 */
export const createAuthRouter = (auth: AuthService, loginLimiter: RequestHandler): Router => {
  const controller = createAuthController(auth);
  const router = Router();

  router.post('/register', validate({ body: registerSchema }), controller.register);
  router.post('/login', validate({ body: loginSchema }), loginLimiter, controller.login);
  router.post('/refresh', validate({ body: refreshSchema }), controller.refresh);
  router.post('/logout', validate({ body: refreshSchema }), controller.logout);

  return router;
};
