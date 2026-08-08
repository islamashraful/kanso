import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import request from 'supertest';

import { app, db, json, resetDatabase } from '@/test/support';
import type { ErrorResponse } from '@/test/support';

interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; name: string };
}

const CREDENTIALS = {
  email: 'ada@test.local',
  password: 'correct-horse-battery-staple',
  name: 'Ada',
};

const register = () => request(app).post('/api/v1/auth/register').send(CREDENTIALS);

const login = (password = CREDENTIALS.password) =>
  request(app).post('/api/v1/auth/login').send({ email: CREDENTIALS.email, password });

beforeEach(resetDatabase);

afterAll(async () => {
  await resetDatabase();
  await db.$disconnect();
});

describe('POST /api/v1/auth/register', () => {
  it('creates a user and returns a token pair', async () => {
    const res = await register();

    expect(res.status).toBe(201);
    expect(json<AuthResponse>(res).user).toMatchObject({ email: CREDENTIALS.email, name: 'Ada' });
    expect(json<AuthResponse>(res).accessToken).toBeString();
    expect(json<AuthResponse>(res).refreshToken).toBeString();
  });

  it('never returns the password hash', async () => {
    const res = await register();

    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
    expect(JSON.stringify(res.body)).not.toContain(CREDENTIALS.password);
  });

  it('stores a hash, not the password', async () => {
    await register();
    const user = await db.user.findUnique({ where: { email: CREDENTIALS.email } });

    expect(user?.passwordHash).not.toBe(CREDENTIALS.password);

    // Pinning the algorithm, not just the fact that something was hashed: a
    // fast digest like SHA-256 would satisfy the assertion above and still be
    // brute-forceable offline. Argon2 is deliberately slow and memory-hard.
    expect(user?.passwordHash).toStartWith('$argon2');
  });

  it('rejects a duplicate email', async () => {
    await register();
    const res = await register();

    expect(res.status).toBe(409);
    expect(json<ErrorResponse>(res).error.code).toBe('CONFLICT');
  });

  it('rejects a short password with a field-level message', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ ...CREDENTIALS, password: 'short' });

    expect(res.status).toBe(400);
    expect(json<ErrorResponse>(res).error.details).toEqual([
      { path: 'body.password', message: 'Must be at least 12 characters' },
    ]);
  });
});

describe('POST /api/v1/auth/login', () => {
  it('returns a token pair for correct credentials', async () => {
    await register();
    const res = await login();

    expect(res.status).toBe(200);
    expect(json<AuthResponse>(res).accessToken).toBeString();
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    await register();

    const wrongPassword = await login('wrong-password-entirely');
    const unknownEmail = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@test.local', password: CREDENTIALS.password });

    // Identical on purpose. A different message for an unregistered address
    // turns this endpoint into a way to discover who has an account.
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(json<ErrorResponse>(wrongPassword).error).toEqual(
      json<ErrorResponse>(unknownEmail).error,
    );
  });

  it('issues a distinct refresh token each time', async () => {
    await register();
    const first = json<AuthResponse>(await login()).refreshToken;
    const second = json<AuthResponse>(await login()).refreshToken;

    expect(first).not.toBe(second);
  });

  it('stores only a hash of the refresh token', async () => {
    await register();
    const { refreshToken } = json<AuthResponse>(await login());

    const stored = await db.refreshToken.findMany();
    expect(stored).not.toBeEmpty();
    for (const row of stored) {
      expect(row.tokenHash).not.toBe(refreshToken);
    }
  });
});

describe('POST /api/v1/auth/refresh', () => {
  const refresh = (refreshToken: string) =>
    request(app).post('/api/v1/auth/refresh').send({ refreshToken });

  it('exchanges a refresh token for a new pair', async () => {
    const { refreshToken } = json<AuthResponse>(await register());
    const res = await refresh(refreshToken);

    expect(res.status).toBe(200);
    expect(json<AuthResponse>(res).refreshToken).not.toBe(refreshToken);
  });

  it('retires the old token, so each one works exactly once', async () => {
    const { refreshToken } = json<AuthResponse>(await register());
    await refresh(refreshToken);

    const replayed = await refresh(refreshToken);

    expect(replayed.status).toBe(401);
  });

  it('revokes every session when a retired token is presented again', async () => {
    const { refreshToken } = json<AuthResponse>(await register());
    const rotated = json<AuthResponse>(await refresh(refreshToken)).refreshToken;

    // The old token surfacing again means it exists in two places: the real
    // client and someone else. There is no way to tell which is asking, so
    // both are cut off — including the token the legitimate client is holding.
    const replayed = await refresh(refreshToken);
    expect(replayed.status).toBe(401);
    expect(json<ErrorResponse>(replayed).error.message).toBe('Refresh token reuse detected');

    const afterReuse = await refresh(rotated);
    expect(afterReuse.status).toBe(401);
  });

  it('rejects an expired refresh token', async () => {
    const { refreshToken } = json<AuthResponse>(await register());
    await db.refreshToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });

    const res = await refresh(refreshToken);

    expect(res.status).toBe(401);
    expect(json<ErrorResponse>(res).error.message).toBe('Refresh token expired');
  });

  it('rejects a token that was never issued', async () => {
    const res = await refresh('not-a-token-this-server-ever-minted');

    expect(res.status).toBe(401);
  });
});

describe('POST /api/v1/auth/logout', () => {
  it('revokes the refresh token', async () => {
    const { refreshToken } = json<AuthResponse>(await register());

    const res = await request(app).post('/api/v1/auth/logout').send({ refreshToken });
    expect(res.status).toBe(204);

    const reused = await request(app).post('/api/v1/auth/refresh').send({ refreshToken });
    expect(reused.status).toBe(401);
  });

  it('succeeds for a token that does not exist', async () => {
    // Logging out is not something a caller should be able to fail at, and a
    // distinguishable response would confirm a guessed token is real.
    const res = await request(app).post('/api/v1/auth/logout').send({ refreshToken: 'nonsense' });

    expect(res.status).toBe(204);
  });
});
