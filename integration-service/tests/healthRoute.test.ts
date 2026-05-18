import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest';
import type { Request, Response } from 'express';

import { createHealthController, createOpsDiagnosticsController } from '../src/controllers/healthController.js';

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

describe('GET /internal/glpi/diagnostics handler', () => {
  it('returns read-only operational diagnostics without secrets or shell commands', async () => {
    const rowsByQuery = vi.fn().mockImplementation(async (text: string) => {
      if (text.includes('information_schema.columns')) {
        return {
          rows: [
            { table_name: 'glpi_plugin_integaglpi_conversations', column_name: 'glpi_entity_id' },
            { table_name: 'glpi_plugin_integaglpi_conversations', column_name: 'glpi_entity_name' },
            { table_name: 'glpi_plugin_integaglpi_entity_selection_attempts', column_name: 'idempotency_key' },
            { table_name: 'glpi_plugin_integaglpi_messages', column_name: 'delivery_status' },
          ],
        };
      }
      if (text.includes('glpi_plugin_integaglpi_entity_selection_attempts')) {
        return {
          rows: [{
            conversation_id: 'conv-1',
            status: 'failed_before_ticket',
            glpi_entity_id: 56,
            glpi_ticket_id: null,
            display_status: 'ambiguous_reconciliation',
            error_message_sanitized: 'ambiguous_reconciliation: 2112319241,2112319242',
            updated_at: new Date('2026-05-12T00:00:00.000Z'),
          }],
        };
      }
      if (text.includes('delivery_status')) {
        return { rows: [{ status: 'read', total: 3 }] };
      }
      return { rows: [{ '?column?': 1 }] };
    });
    const handler = createOpsDiagnosticsController(
      { query: rowsByQuery },
      { checkApiHealth: vi.fn().mockResolvedValue({ ok: true, latencyMs: 12, errorStage: null }) },
    );
    const res = mockRes();

    await handler(mockReq, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = (res as unknown as { json: ReturnType<typeof vi.fn> }).json.mock.calls[0]?.[0] as Record<string, unknown>;
    const serialized = JSON.stringify(body);
    expect(serialized).toContain('ambiguous_reconciliation');
    expect(serialized).not.toMatch(/META_ACCESS_TOKEN|GLPI_APP_TOKEN|Bearer|shell_exec|docker|psql|pg_dump|certbot/);
  });
});
