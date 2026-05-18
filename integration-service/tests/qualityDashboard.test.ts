import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app.js';
import { QualityDashboardService } from '../src/services/QualityDashboardService.js';

const apiKey = 'test-integration-service-api-key-32chars-min';

function createExecutor() {
  return {
    query: vi.fn().mockImplementation(async (text: string) => {
      if (text.includes('COUNT(*)::int AS total_conversations')) {
        return { rows: [{ total_conversations: 2, total_tickets_created: 1, tickets_open: 1 }] };
      }
      if (text.includes('JOIN glpi_plugin_integaglpi_messages m')) {
        return { rows: [{ status: 'delivered', total: 1, error_code: '', error_message_sanitized: '' }] };
      }
      if (text.includes('JOIN glpi_plugin_integaglpi_inactivity_job_events')) {
        return { rows: [{ status: 'sent', event_key: 'inactivity_reminder_1', reason: '', total: 1 }] };
      }
      if (text.includes("COALESCE(b.csat_rating, 'sem_resposta')")) {
        return { rows: [{ csat_rating: 'satisfied', total: 1 }] };
      }
      if (text.includes('jsonb_array_elements_text')) {
        return { rows: [{ flag: 'supervisor_review_required', total: 1 }] };
      }
      if (text.includes('WITH usage AS')) {
        return { rows: [{ glpi_entity_id: 10, glpi_entity_name: 'Cliente', allocated_hours: 10, consumed_hours: 8, usage_percent: 80, alert_status: 'warning' }] };
      }
      if (text.includes('last_message_excerpt') && text.includes('LIMIT')) {
        return {
          rows: [{
            conversation_id: 'conv-1',
            masked_phone: '55******1234',
            glpi_ticket_id: 123,
            entity_id: 10,
            entity_name: 'Cliente',
            conversation_status: 'open',
            sla_state: 'ok',
          }],
        };
      }
      if (text.includes('SELECT COUNT(*)::int AS total FROM base')) {
        return { rows: [{ total: 1 }] };
      }
      return { rows: [] };
    }),
  };
}

function createCache(seed?: Record<string, string>) {
  const values = new Map(Object.entries(seed ?? {}));
  return {
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    setex: vi.fn(async (key: string, _ttl: number, value: string) => {
      values.set(key, value);
      return 'OK';
    }),
  };
}

function createTestApp(service: QualityDashboardService) {
  return createApp({
    inboundWebhookService: { process: vi.fn() } as never,
    metaAppSecret: 'meta-secret',
    metaVerifyToken: 'verify-token',
    outboundMessageService: { send: vi.fn() } as never,
    integrationServiceApiKey: apiKey,
    qualityDashboardService: service,
  });
}

describe('Quality Dashboard internal route', () => {
  it('requires Bearer authorization', async () => {
    const service = new QualityDashboardService(createExecutor(), createCache());
    const app = createTestApp(service);

    const response = await request(app)
      .get('/internal/glpi/quality-dashboard?date_from=2026-05-01&date_to=2026-05-10&entity_ids=10');

    expect(response.status).toBe(401);
  });

  it('returns read-only KPIs with Redis cache miss then hit', async () => {
    const executor = createExecutor();
    const cache = createCache();
    const service = new QualityDashboardService(executor, cache);
    const app = createTestApp(service);

    const first = await request(app)
      .get('/internal/glpi/quality-dashboard?date_from=2026-05-01&date_to=2026-05-10&entity_ids=10&limit=25')
      .set('Authorization', `Bearer ${apiKey}`);
    const second = await request(app)
      .get('/internal/glpi/quality-dashboard?date_from=2026-05-01&date_to=2026-05-10&entity_ids=10&limit=25')
      .set('Authorization', `Bearer ${apiKey}`);

    expect(first.status).toBe(200);
    expect(first.body.cache_status).toBe('miss');
    expect(first.body.kpis.total_conversations).toBe(2);
    expect(first.body.rows[0].masked_phone).toBe('55******1234');
    expect(second.status).toBe(200);
    expect(second.body.cache_status).toBe('hit');
    expect(cache.setex).toHaveBeenCalled();
  });

  it('rejects date ranges above 30 days and missing entity scope', async () => {
    const service = new QualityDashboardService(createExecutor(), createCache());
    const app = createTestApp(service);

    const range = await request(app)
      .get('/internal/glpi/quality-dashboard?date_from=2026-04-01&date_to=2026-05-10&entity_ids=10')
      .set('Authorization', `Bearer ${apiKey}`);
    const scope = await request(app)
      .get('/internal/glpi/quality-dashboard?date_from=2026-05-01&date_to=2026-05-10')
      .set('Authorization', `Bearer ${apiKey}`);

    expect(range.status).toBe(400);
    expect(range.body.error_code).toBe('DATE_RANGE_TOO_LARGE');
    expect(scope.status).toBe(403);
    expect(scope.body.error_code).toBe('ENTITY_SCOPE_REQUIRED');
  });
});
