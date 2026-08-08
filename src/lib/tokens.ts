import { createHash, randomBytes } from 'node:crypto';

import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';

import type { Config } from '@/config';
import { UnauthorizedError } from '@/lib/errors';

const ALGORITHM = 'HS256';

/**
 * The access token payload. `sub` is the user id and the only claim this
 * application puts there: the organization and the role are read from the
 * database on every request, so a membership change takes effect immediately
 * rather than when the token expires. See docs/adr/0011.
 */
export interface AccessTokenPayload {
  sub: string;
}

/**
 * Token signing, verification and refresh token minting.
 *
 * Verification is deliberately not part of the auth middleware. Week 2's
 * WebSocket handshake authenticates during the upgrade, where there is no
 * `req` or `res` to hand to Express middleware, and it needs to call exactly
 * the same check. See docs/adr/0011.
 */
export const createTokens = (config: Config) => {
  const secret = new TextEncoder().encode(config.JWT_SECRET);

  /**
   * Refresh tokens are opaque random strings rather than JWTs. Nothing reads
   * claims from them — they are looked up in the database, which is also what
   * makes them revocable, so a signed payload would carry no benefit.
   */
  const generateRefreshToken = (): string => randomBytes(32).toString('base64url');

  /**
   * Only the hash is ever stored. SHA-256 without a salt is the right choice
   * here and would be wrong for a password: the input is 32 bytes of entropy,
   * so there is no dictionary to attack and no reason to make lookup slow.
   */
  const hashRefreshToken = (token: string): string =>
    createHash('sha256').update(token).digest('hex');

  const signAccessToken = async (userId: string): Promise<string> =>
    new SignJWT()
      .setProtectedHeader({ alg: ALGORITHM })
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime(config.ACCESS_TOKEN_TTL)
      .sign(secret);

  const verifyAccessToken = async (token: string): Promise<AccessTokenPayload> => {
    try {
      const { payload } = await jwtVerify(token, secret, { algorithms: [ALGORITHM] });

      // `sub` is optional in the JWT spec, so its presence is checked rather
      // than assumed: a token signed by this key but without a subject is
      // malformed for our purposes, not merely unusual.
      if (!payload.sub) throw new UnauthorizedError('Token has no subject');

      return { sub: payload.sub };
    } catch (error) {
      if (error instanceof UnauthorizedError) throw error;

      // Expiry is reported separately so a client knows to refresh rather than
      // to send the user back to the login form. Every other failure — bad
      // signature, wrong algorithm, malformed input — collapses into one
      // message, because distinguishing them only helps an attacker.
      if (error instanceof joseErrors.JWTExpired) {
        throw new UnauthorizedError('Access token expired');
      }
      throw new UnauthorizedError('Invalid access token');
    }
  };

  return { generateRefreshToken, hashRefreshToken, signAccessToken, verifyAccessToken };
};

export type Tokens = ReturnType<typeof createTokens>;
