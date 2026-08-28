import { describe, expect, it } from 'bun:test';
import request from 'supertest';

import { app } from '@/test/support';

describe('GET /health', () => {
  it('reports ok without touching the database or Redis', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('GET /health/ready', () => {
  it('reports ok when the database and Redis are reachable', async () => {
    const res = await request(app).get('/health/ready');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'ok',
      checks: { database: 'ok', redis: 'ok' },
    });
  });
});
