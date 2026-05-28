/**
 * aiConfigRuntime.test.ts
 *
 * Validates health / diagnostics hardening:
 *   - /health exposes only a sanitized AI runtime summary (no raw config, no secrets)
 *   - /health always indicates /internal/glpi/diagnostics as the authoritative endpoint
 *   - /health degrades safely (env fallback, 503) when Postgres is unavailable
 *   - /internal/glpi/diagnostics exposes detailed config for ops use (no secrets in raw config)
 *
 * All tests use in-process mocks — no real DB, Redis, HTTP, Ollama or cloud calls.
 */

import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

import { createHealthController, createOpsDiagnosticsController } from '../src/controllers/healthController.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

function getBody(res: Response): Record<string, unknown> {
  return (res as unknown as { json: ReturnType<typeof vi.fn> }).json.mock.calls[0]?.[0] as Record<string, unknown>;
}

/** Builds a mock pool that returns DB AI settings rows. */
function mockPoolWithAiSettings() {
  return vi.fn().mockImplementation(async (text: string) => {
    if (text.includes('SELECT 1')) {
      return { rows: [{ '?column?': 1 }] };
    }
    if (text.includes('information_schema.columns')) {
      return {
        rows: [
          { column_name: 'context' },
          { column_name: 'updated_at' },
          { column_name: 'ai_supervisor_model' },
          { column_name: 'ai_supervisor_timeout_seconds' },
          { column_name: 'copilot_model' },
          { column_name: 'copilot_timeout_ms' },
        ],
      };
    }
    if (text.includes('FROM glpi_plugin_integaglpi_configs')) {
      return {
        rows: [{
          updated_at: new Date('2026-05-27T12:00:00.000Z'),
          ai_supervisor_model: 'deepseek-r1:8b',
          ai_supervisor_timeout_seconds: 45,
          copilot_model: 'command-r7b:latest',
          copilot_timeout_ms: 45000,
        }],
      };
    }
    return { rows: [] };
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AI runtime config diagnostics', () => {

  // ── 1. /health summary — DB-sourced config ────────────────────────────────

  it('exposes a sanitized AI runtime summary on /health for runtime checks', async () => {
    const handler = createHealthController({ query: mockPoolWithAiSettings() });
    const res = mockRes();

    await handler({} as Request, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = getBody(res);
    const serialized = JSON.stringify(body);

    // Raw config must never appear in the /health body.
    expect(body.ai_runtime_config_present).toBe(true);
    expect(body.ai_runtime_config).toBeUndefined();

    // Sanitized summary must be present and reference the authoritative endpoint.
    expect(serialized).toContain('ai_runtime_config_summary');
    expect(serialized).toContain('/internal/glpi/diagnostics');

    // DB-sourced values appear in the summary.
    expect(serialized).toContain('db_ai_settings');
    expect(serialized).toContain('command-r7b:latest');
    expect(serialized).toContain('deepseek-r1:8b');

    // The summary itself must not leak any sensitive term.
    const summaryOnly = JSON.stringify(body.ai_runtime_config_summary);
    expect(summaryOnly).not.toMatch(/api[_-]?key|apikey|bearer|password|passwd|secret|base_url|app-token|session-token|authorization/i);
  });

  // ── 2. /internal/glpi/diagnostics — ops detail endpoint ──────────────────

  it('exposes non-sensitive effective Node config from ai_settings with env fallback metadata', async () => {
    const query = vi.fn().mockImplementation(async (text: string) => {
      if (text.includes('information_schema.columns')) {
        return {
          rows: [
            { table_name: 'glpi_plugin_integaglpi_conversations', column_name: 'glpi_entity_id' },
            { table_name: 'glpi_plugin_integaglpi_conversations', column_name: 'glpi_entity_name' },
            { table_name: 'glpi_plugin_integaglpi_messages', column_name: 'delivery_status' },
            { table_name: 'glpi_plugin_integaglpi_configs', column_name: 'context' },
            { table_name: 'glpi_plugin_integaglpi_configs', column_name: 'updated_at' },
            { table_name: 'glpi_plugin_integaglpi_configs', column_name: 'ai_supervisor_model' },
            { table_name: 'glpi_plugin_integaglpi_configs', column_name: 'ai_supervisor_timeout_seconds' },
            { table_name: 'glpi_plugin_integaglpi_configs', column_name: 'copilot_model' },
            { table_name: 'glpi_plugin_integaglpi_configs', column_name: 'copilot_timeout_ms' },
          ],
        };
      }
      if (text.includes('FROM glpi_plugin_integaglpi_configs')) {
        return {
          rows: [{
            updated_at: new Date('2026-05-27T12:00:00.000Z'),
            ai_supervisor_model: 'deepseek-r1:8b',
            ai_supervisor_timeout_seconds: 45,
            copilot_model: 'command-r7b:latest',
            copilot_timeout_ms: 45000,
          }],
        };
      }
      return { rows: [] };
    });
    const handler = createOpsDiagnosticsController({ query });
    const res = mockRes();

    await handler({} as Request, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = getBody(res);
    const serialized = JSON.stringify(body);

    expect(serialized).toContain('ai_runtime_config');
    expect(serialized).toContain('no_cache_db_read_per_request');
    expect(serialized).toContain('command-r7b:latest');
    expect(serialized).toContain('deepseek-r1:8b');

    // The runtime config section must not leak actual secret values.
    const runtimeOnly = JSON.stringify(body.ai_runtime_config);
    expect(runtimeOnly).not.toMatch(/api[_-]?key|apikey|bearer|password|passwd/i);
  });

  // ── 3. Full /health body security scan ───────────────────────────────────

  it('full /health body does not serialize any sensitive terms', async () => {
    // Use a simple pool: Postgres up, schema present, no ai_settings rows.
    const query = vi.fn().mockImplementation(async (text: string) => {
      if (text.includes('SELECT 1')) return { rows: [{ '?column?': 1 }] };
      if (text.includes('information_schema.columns')) {
        return { rows: [{ column_name: 'context' }] };
      }
      return { rows: [] };
    });
    const handler = createHealthController({ query });
    const res = mockRes();

    await handler({} as Request, res);

    const body = getBody(res);
    const serialized = JSON.stringify(body);

    // The full /health body must not contain any of the following sensitive terms.
    // Note: field names such as "app_signature_configured" contain no sensitive words.
    // Values are booleans/numbers/safe strings — actual secret values are never serialized.
    expect(serialized).not.toMatch(/api[_-]?key|apikey|bearer|password|passwd|secret|base_url|app-token|session-token|authorization/i);
  });

  // ── 4. /health degrades safely when Postgres is unavailable ──────────────

  it('/health returns 503 with env fallback summary when postgres is unavailable', async () => {
    const query = vi.fn().mockRejectedValue(new Error('connection refused'));
    const handler = createHealthController({ query });
    const res = mockRes();

    await handler({} as Request, res);

    expect(res.status).toHaveBeenCalledWith(503);
    const body = getBody(res);

    // Body is still present and safe.
    expect(body.ok).toBe(false);
    expect(body.postgres).toMatchObject({ ok: false });

    // Summary must be present even in fallback.
    const summary = body.ai_runtime_config_summary as Record<string, unknown>;
    expect(summary).toBeDefined();
    expect(summary.source).toBe('env');
    expect(summary.authoritative_endpoint).toBe('/internal/glpi/diagnostics');

    // Fallback summary must also be free of sensitive terms.
    const summaryOnly = JSON.stringify(summary);
    expect(summaryOnly).not.toMatch(/api[_-]?key|apikey|bearer|password|passwd|secret|base_url|app-token|session-token|authorization/i);

    // Raw config must not be exposed even in the fallback path.
    expect(body.ai_runtime_config).toBeUndefined();
  });

  // ── 5. /health returns source env when no ai_settings row in DB ──────────

  it('/health returns source env in summary when no ai_settings row exists', async () => {
    // Schema has the context column but the ai_settings row is absent.
    const query = vi.fn().mockImplementation(async (text: string) => {
      if (text.includes('SELECT 1')) return { rows: [{ '?column?': 1 }] };
      if (text.includes('information_schema.columns')) {
        return {
          rows: [
            { column_name: 'context' },
            { column_name: 'ai_supervisor_model' },
          ],
        };
      }
      // ai_settings context returns no data row.
      return { rows: [] };
    });
    const handler = createHealthController({ query });
    const res = mockRes();

    await handler({} as Request, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = getBody(res);

    const summary = body.ai_runtime_config_summary as Record<string, unknown>;
    expect(summary.source).toBe('env');
    expect(summary.authoritative_endpoint).toBe('/internal/glpi/diagnostics');

    // Raw config absent.
    expect(body.ai_runtime_config).toBeUndefined();
  });

});
