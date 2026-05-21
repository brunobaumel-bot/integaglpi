import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app.js';
import { maskEmail, maskPhone, ObservabilityService } from '../src/services/ObservabilityService.js';

const apiKey = 'test-integration-service-api-key-32chars-min';

function createTestApp(observabilityService: { getDashboard: ReturnType<typeof vi.fn> }) {
  const app = createApp({
    inboundWebhookService: { process: vi.fn() } as never,
    metaAppSecret: 'meta-secret',
    metaVerifyToken: 'verify-token',
    outboundMessageService: { send: vi.fn() } as never,
    integrationServiceApiKey: apiKey,
    observabilityService: observabilityService as never,
  });

  return app;
}

describe('Observability internal route', () => {
  it('requires Bearer authorization', async () => {
    const app = createTestApp({ getDashboard: vi.fn() });

    const response = await request(app).get('/internal/glpi/observability');

    expect(response.status).toBe(401);
  });

  it('returns read-only dashboard data through the internal endpoint', async () => {
    const service = {
      getDashboard: vi.fn(async () => ({
        ok: true,
        read_only: true,
        events: [],
        pagination: { page: 1, limit: 20, total: 0 },
      })),
    };
    const app = createTestApp(service);

    const response = await request(app)
      .get('/internal/glpi/observability?period=7&severity=error&limit=20')
      .set('Authorization', `Bearer ${apiKey}`);

    expect(response.status).toBe(200);
    expect(response.body.read_only).toBe(true);
    expect(service.getDashboard).toHaveBeenCalledWith(expect.objectContaining({
      periodDays: 7,
      severity: 'error',
      limit: 20,
    }));
  });
});

describe('ObservabilityService', () => {
  it('masks PII in helper functions', () => {
    expect(maskPhone('+5511999998888')).toBe('+55****8888');
    expect(maskEmail('tecnico@example.com')).toBe('t***o@example.com');
  });

  it('returns paginated, sanitized read-only events', async () => {
    const query = vi.fn(async (text: string) => {
      if (text.includes('SELECT *') && text.includes('observability_events')) {
        return {
          rows: [{
            id: 'msg-1',
            source: 'delivery',
            event_type: 'DELIVERY_FAILED',
            severity: 'error',
            status: 'failed',
            ticket_id: 123,
            conversation_id: 'conv-1',
            message_id: 'wamid-1',
            phone_e164: '+5511999998888',
            error_message: 'Authorization: Bearer abc token=secret cliente tecnico@example.com',
            payload_json: {
              access_token: 'meta-token',
              nested: { app_secret: 'secret', phone: '+551188887777' },
            },
            created_at: '2026-05-21T12:00:00.000Z',
          }],
        };
      }
      if (text.includes('COUNT(*)::int AS total') && text.includes('observability_events')) {
        return { rows: [{ total: 1 }] };
      }
      if (text.includes('MAX(created_at) AS last_inbound_at')) {
        return { rows: [{ last_inbound_at: '2026-05-21T11:00:00.000Z' }] };
      }
      if (text.includes('COUNT(*) FILTER')) {
        return { rows: [{}] };
      }
      return { rows: [] };
    });
    const service = new ObservabilityService(
      { query },
      { status: 'ready', ping: vi.fn(async () => 'PONG') },
      { checkApiHealth: vi.fn(async () => ({ ok: true, latencyMs: 12, errorStage: null })) },
    );

    const result = await service.getDashboard({
      periodDays: 1,
      severity: 'error',
      page: 1,
      limit: 20,
    });

    expect(result.read_only).toBe(true);
    expect(result.pagination).toEqual(expect.objectContaining({ limit: 20, total: 1 }));
    const serialized = JSON.stringify(result);
    expect(serialized).toContain('+55****8888');
    expect(serialized).toContain('[REDACTED]');
    expect(serialized).not.toContain('meta-token');
    expect(serialized).not.toContain('Bearer abc');
    expect(serialized).not.toContain('tecnico@example.com');
  });
});
