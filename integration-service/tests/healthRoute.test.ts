import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest';
import type { Request, Response } from 'express';

import { createHealthController } from '../src/controllers/healthController.js';

function mockRes() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

const mockReq = {} as Request;
const originalUptime = process.uptime;

describe('GET /health handler', () => {
  let query: ReturnType<typeof vi.fn>;
  let pool: { query: (text: string) => Promise<unknown> };
  let handler: ReturnType<typeof createHealthController>;

  beforeEach(() => {
    query = vi.fn().mockResolvedValue({ rowCount: 1 });
    pool = { query };
    handler = createHealthController(pool);
  });

  afterAll(() => {
    process.uptime = originalUptime;
  });

  it('returns 200 and ok when postgres is healthy', async () => {
    const res = mockRes();
    await handler(mockReq, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const call = (res as unknown as { json: ReturnType<typeof vi.fn> }).json.mock.calls[0]?.[0] as {
      ok: boolean;
      service: string;
      postgres: { ok: boolean; latency_ms?: number };
    };
    expect(call.ok).toBe(true);
    expect(call.service).toBe('integration-service');
    expect(call.postgres.ok).toBe(true);
    expect(typeof call.postgres.latency_ms).toBe('number');
  });

  it('returns 503 and ok false when postgres fails', async () => {
    query.mockRejectedValue(new Error('db down'));
    const res = mockRes();
    await handler(mockReq, res);

    expect(res.status).toHaveBeenCalledWith(503);
    const call = (res as unknown as { json: ReturnType<typeof vi.fn> }).json.mock.calls[0]?.[0] as {
      ok: boolean;
      postgres: { ok: boolean; latency_ms?: number };
    };
    expect(call.ok).toBe(false);
    expect(call.postgres.ok).toBe(false);
  });
});
