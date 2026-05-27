import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

import { createOpsDiagnosticsController } from '../src/controllers/healthController.js';

function mockRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

describe('AI runtime config diagnostics', () => {
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
    const body = (res as unknown as { json: ReturnType<typeof vi.fn> }).json.mock.calls[0]?.[0] as Record<string, unknown>;
    const serialized = JSON.stringify(body);
    expect(serialized).toContain('ai_runtime_config');
    expect(serialized).toContain('no_cache_db_read_per_request');
    expect(serialized).toContain('command-r7b:latest');
    expect(serialized).toContain('deepseek-r1:8b');
    const runtimeOnly = JSON.stringify(body.ai_runtime_config);
    expect(runtimeOnly).not.toMatch(/api[_-]?key|bearer|password|secret/i);
  });
});
