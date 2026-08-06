import type { RequestHandler } from 'express';

import type { Db } from '@/lib/db';
import { ForbiddenError, UnauthorizedError } from '@/lib/errors';

/**
 * Resolves the caller and the organization they are acting in.
 *
 * TEMPORARY: identity comes from an `x-user-id` header. JWT verification
 * replaces that lookup later in week 1; nothing downstream changes, because
 * controllers and services only ever read `req.auth`.
 *
 * The organization is named by the client via `x-org-id`, but is only trusted
 * once a membership row proves the caller belongs to it. That check is the
 * whole point: without it, any caller could read any tenant's data by naming
 * a different organization. See docs/adr/0007.
 */
export const createRequireAuth = (db: Db): RequestHandler => {
  return async (req, _res, next) => {
    const userId = req.get('x-user-id');
    const organizationId = req.get('x-org-id');

    if (!userId || !organizationId) {
      throw new UnauthorizedError('Missing x-user-id or x-org-id');
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
