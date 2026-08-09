import type { RequestHandler } from 'express';

import type { Role } from '@/generated/prisma/enums';
import { ForbiddenError, UnauthorizedError } from '@/lib/errors';

/**
 * The roles, weakest first.
 *
 * Typed as a total record of the Prisma enum on purpose: adding a role to the
 * schema fails the typecheck here until it is given a position, so the order
 * cannot drift from the model it describes. See docs/adr/0013.
 */
const RANK: Record<Role, number> = {
  MEMBER: 1,
  ADMIN: 2,
  OWNER: 3,
};

/**
 * Require at least this role in the organization the caller is acting in.
 *
 * Runs after `requireAuth`, which has already verified the membership and put
 * its role on `req.auth`, so this adds no query. Roles nest — an owner passes
 * every check an admin passes — which is why a route names a minimum rather
 * than a set. See docs/adr/0013.
 */
export const requireOrgRole = (minimum: Role): RequestHandler => {
  return (req, _res, next) => {
    if (!req.auth) throw new UnauthorizedError();

    if (RANK[req.auth.role] < RANK[minimum]) {
      // 403 rather than the 404 used for another organization's data: the
      // caller has already proved membership, so the resource's existence is
      // not a secret from them. Only their role is insufficient.
      throw new ForbiddenError(`Requires the ${minimum.toLowerCase()} role`);
    }

    next();
  };
};
