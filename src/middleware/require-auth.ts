import type { RequestHandler } from 'express';

import type { Db } from '@/lib/db';
import { ForbiddenError, ValidationError } from '@/lib/errors';
import type { Tokens } from '@/lib/tokens';

import { authenticate } from './require-user';

/**
 * Resolves the caller and the organization they are acting in.
 *
 * Identity comes from a signed access token; authorization does not. The
 * organization is named by the client via `x-org-id` and is only trusted once a
 * membership row proves the caller belongs to it, on every request. Keeping the
 * organization and role out of the token is what makes a removal or a demotion
 * take effect immediately rather than whenever the token expires.
 * See docs/adr/0007 and docs/adr/0011.
 */
export const createRequireAuth = (db: Db, tokens: Tokens): RequestHandler => {
  return async (req, _res, next) => {
    const userId = await authenticate(req, tokens);

    const organizationId = req.get('x-org-id');

    // A valid token with no organization named is not an authentication
    // failure: the caller proved who they are and simply did not say which
    // tenant they are acting in. That is a malformed request, so 400.
    if (!organizationId) {
      throw new ValidationError([{ path: 'headers.x-org-id', message: 'Required' }]);
    }

    const membership = await db.membership.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
    });

    if (!membership) {
      // Deliberately identical to the response for an organization that does
      // not exist: a caller must not be able to probe which tenants are real.
      throw new ForbiddenError('Not a member of this organization');
    }

    req.auth = {
      userId: membership.userId,
      organizationId: membership.organizationId,
      role: membership.role,
    };

    next();
  };
};
