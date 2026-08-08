import type { Request, RequestHandler } from 'express';

import { UnauthorizedError } from '@/lib/errors';
import type { Tokens } from '@/lib/tokens';

/**
 * Read and verify the bearer token, returning the user it names.
 *
 * Shared by `requireUser` and `requireAuth` so the two cannot disagree about
 * what counts as a valid credential.
 */
export const authenticate = async (req: Request, tokens: Tokens): Promise<string> => {
  const header = req.get('authorization');
  const [scheme, token] = header?.split(' ') ?? [];

  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    throw new UnauthorizedError('Missing bearer token');
  }

  const { sub: userId } = await tokens.verifyAccessToken(token);

  return userId;
};

/**
 * Identity without a tenant.
 *
 * `requireAuth` cannot guard organization creation: it demands an `x-org-id`
 * and a membership proving the caller belongs to it, which is precisely what
 * the caller does not have yet. This is the smaller half — the token is
 * verified, nothing else is claimed — and it is the only place in the API
 * where a request proceeds without an organization. See docs/adr/0012.
 */
export const createRequireUser = (tokens: Tokens): RequestHandler => {
  return async (req, _res, next) => {
    req.user = { id: await authenticate(req, tokens) };
    next();
  };
};
