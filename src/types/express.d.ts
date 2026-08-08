import type { Role } from '@/generated/prisma/enums';

/**
 * The authenticated caller, resolved by `requireAuth` from credentials and a
 * verified membership lookup.
 *
 * `organizationId` is the tenant every downstream query scopes by. It is set
 * here, after checking the caller actually belongs to that organization, so no
 * service ever receives an organization straight from the client.
 */
export interface AuthContext {
  userId: string;
  organizationId: string;
  role: Role;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
      /**
       * The caller, identified but not yet placed in an organization. Set by
       * `requireUser` on the routes that run before a membership exists.
       */
      user?: { id: string };
      /** Output of the `validate` middleware. Never overwrites `req.query`, which is a getter in Express 5. */
      validated?: {
        body?: unknown;
        query?: unknown;
        params?: unknown;
      };
    }
  }
}
