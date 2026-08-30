import type { Config } from '@/config';
import { Prisma } from '@/generated/prisma/client';
import type { Db } from '@/lib/db';
import { ConflictError, UnauthorizedError } from '@/lib/errors';
import type { Tokens } from '@/lib/tokens';

import type { LoginInput, RegisterInput } from './auth.schema';

/**
 * A hash of nothing in particular, compared against when no user matches so
 * that a failed login costs the same whether or not the email exists.
 * Otherwise the response time answers "is this address registered?".
 */
const DUMMY_HASH = await Bun.password.hash('not-a-real-password');

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/** Days to milliseconds, for the refresh token expiry. */
const expiryFrom = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000);

/**
 * Mint a token pair and record the refresh half.
 *
 * Free-standing rather than a method: register and login both need it, but a
 * controller has no business issuing tokens without credentials to show for
 * them, so it stays off the returned object.
 */
const issueTokens = async (
  db: Db,
  tokens: Tokens,
  config: Config,
  userId: string,
): Promise<TokenPair> => {
  const refreshToken = tokens.generateRefreshToken();

  await db.refreshToken.create({
    data: {
      userId,
      tokenHash: tokens.hashRefreshToken(refreshToken),
      expiresAt: expiryFrom(config.REFRESH_TOKEN_TTL_DAYS),
    },
  });

  return { accessToken: await tokens.signAccessToken(userId), refreshToken };
};

/**
 * Authentication business logic.
 *
 * Knows nothing about HTTP: it takes plain arguments, returns plain data, and
 * throws AppError subclasses. See docs/adr/0001 and docs/adr/0003.
 *
 * Nothing here reads or writes an organization. Identity and tenancy are
 * separate concerns: this issues tokens proving who the caller is, and
 * `requireAuth` decides what they may do by looking up a membership on every
 * request. See docs/adr/0011.
 */
export const createAuthService = (db: Db, tokens: Tokens, config: Config) => ({
  async register(input: RegisterInput): Promise<{ user: AuthUser } & TokenPair> {
    const existing = await db.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });

    // Returning 409 admits the address is taken. That is a real disclosure,
    // accepted because the alternative — accepting the registration and
    // sending an email instead — needs a mail pipeline that does not exist
    // yet. Revisit when one does.
    if (existing) throw new ConflictError('Email already registered');

    let user;
    try {
      user = await db.user.create({
        data: {
          email: input.email,
          name: input.name,
          // Bun's default is argon2id, and the parameters it chose are written
          // into the hash — so raising the cost later leaves old hashes verifying
          // under their own settings rather than locking anyone out.
          passwordHash: await Bun.password.hash(input.password),
        },
        select: { id: true, email: true, name: true },
      });
    } catch (error) {
      // The check above has a race window: two requests for the same email
      // can both pass it before either commits. Left unhandled, the loser
      // reaches the error middleware as a 500 instead of the 409 every other
      // duplicate-email path returns. Same reasoning as
      // `organizations.service.ts`'s `create`.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError('Email already registered');
      }
      throw error;
    }

    return { user, ...(await issueTokens(db, tokens, config, user.id)) };
  },

  async login(input: LoginInput): Promise<{ user: AuthUser } & TokenPair> {
    const user = await db.user.findUnique({ where: { email: input.email } });

    // Verify even when no user matched, then fail identically either way: a
    // different message or a faster answer for an unknown address turns this
    // endpoint into a way to enumerate accounts.
    const valid = await Bun.password.verify(input.password, user?.passwordHash ?? DUMMY_HASH);

    if (!user || !valid) throw new UnauthorizedError('Invalid email or password');

    return {
      user: { id: user.id, email: user.email, name: user.name },
      ...(await issueTokens(db, tokens, config, user.id)),
    };
  },

  /**
   * Exchange a refresh token for a new pair, invalidating the old one.
   *
   * Rotation is what makes a long-lived refresh token tolerable: each one
   * works once, so a stolen token is only useful until the real user next
   * refreshes. That also makes theft detectable — see below.
   */
  async refresh(rawToken: string): Promise<TokenPair> {
    const stored = await db.refreshToken.findUnique({
      where: { tokenHash: tokens.hashRefreshToken(rawToken) },
    });

    if (!stored) throw new UnauthorizedError('Invalid refresh token');

    if (stored.revokedAt) {
      // A token that was already rotated is being presented again, so it
      // exists in two places: the legitimate client and someone else. There
      // is no way to tell which one is asking, so end every session and make
      // both log in.
      await db.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedError('Refresh token reuse detected');
    }

    if (stored.expiresAt <= new Date()) throw new UnauthorizedError('Refresh token expired');

    const refreshToken = tokens.generateRefreshToken();

    // One transaction, because revoking the old token and issuing its
    // replacement must not come apart: half of this leaves the user either
    // holding two live tokens or none.
    await db.$transaction([
      db.refreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: new Date() },
      }),
      db.refreshToken.create({
        data: {
          userId: stored.userId,
          tokenHash: tokens.hashRefreshToken(refreshToken),
          expiresAt: expiryFrom(config.REFRESH_TOKEN_TTL_DAYS),
        },
      }),
    ]);

    return { accessToken: await tokens.signAccessToken(stored.userId), refreshToken };
  },

  /**
   * Revoking is deliberately silent about whether the token was real.
   * Logging out is not an operation a caller should be able to fail at, and
   * a distinguishable response would confirm a guessed token exists.
   */
  async logout(rawToken: string): Promise<void> {
    await db.refreshToken.updateMany({
      where: { tokenHash: tokens.hashRefreshToken(rawToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  },
});

export type AuthService = ReturnType<typeof createAuthService>;
