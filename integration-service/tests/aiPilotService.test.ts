import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app.js';
import { AiPilotBudgetGuard } from '../src/aiPilot/budgetGuard.js';
import { AiPilotRepository } from '../src/aiPilot/repository.js';
import type { AiPilotConfig } from '../src/aiPilot/types.js';
import type { CloudPilotProvider } from '../src/cloud/providerRegistry.js';
import { AiPilotService } from '../src/domain/services/AiPilotService.js';

const apiKey = 'test-integration-service-api-key-32chars-min';

const baseConfig: AiPilotConfig = {
  cloudEnabled: false,
  embeddingsEnabled: false,
  provider: 'disabled',
  model: 'pilot-disabled',
  monthlyBudgetLimit: 0,
  hardBudgetBlock: true,
  dpoApproved: false,
  adminOptIn: false,
  incidentAck: false,
  testEnvironmentOnly: true,
  environment: 'test',
  timeoutMs: 45_000,
  retryCount: 1,
};

function executor(monthCost = 0) {
  return {
    query: vi.fn(async (sql: string) => {
      if (sql.includes('to_regclass')) {
        return { rows: [{ exists: true }], rowCount: 1, command: '', oid: 0, fields: [] };
      }
      if (sql.includes('SUM(COALESCE')) {
        return { rows: [{ total: monthCost }], rowCount: 1, command: '', oid: 0, fields: [] };
      }
      return { rows: [], rowCount: 0, command: '', oid: 0, fields: [] };
    }),
  };
}

function createService(config: Partial<AiPilotConfig> = {}, options: { monthCost?: number; provider?: CloudPilotProvider } = {}) {
  const exec = executor(options.monthCost ?? 0);
  const provider = options.provider ?? { complete: vi.fn(async () => ({ text: 'cloud ok', provider: 'cloud', estimatedCost: 0.01, actualCost: 0.01 })) };
  const repository = new AiPilotRepository(exec);
  const audit = { recordAuditEventSafe: vi.fn(async () => undefined) };
  const service = new AiPilotService(
    { ...baseConfig, ...config },
    provider,
    new AiPilotBudgetGuard(exec, config.monthlyBudgetLimit ?? baseConfig.monthlyBudgetLimit, config.hardBudgetBlock ?? baseConfig.hardBudgetBlock),
    repository,
    audit as never,
  );
  return { service, exec, provider, audit };
}

describe('AI cloud and embeddings pilot service', () => {
  it('is disabled by default and records a blocked audit without calling provider', async () => {
    const { service, provider, audit } = createService();
    const result = await service.runSyntheticTest({ payload: 'payload sintetico', requestedByGlpiUserId: 7 });

    expect(result.ok).toBe(false);
    expect(result.blockedReason).toBe('AI_PILOT_CLOUD_DISABLED');
    expect(provider.complete).not.toHaveBeenCalled();
    expect(audit.recordAuditEventSafe).toHaveBeenCalledWith(expect.objectContaining({ source: 'AiPilotService' }));
  });

  it('requires admin opt-in, DPO approval and incident acknowledgement', async () => {
    const { service } = createService({ cloudEnabled: true, provider: 'cloud', monthlyBudgetLimit: 10 });
    const result = await service.runSyntheticTest({ payload: 'payload sintetico' });

    expect(result.blockedReason).toBe('AI_PILOT_ADMIN_OPT_IN_REQUIRED');
  });

  it('hard-blocks when monthly budget would be exceeded', async () => {
    const { service } = createService({
      cloudEnabled: true,
      provider: 'cloud',
      adminOptIn: true,
      dpoApproved: true,
      incidentAck: true,
      monthlyBudgetLimit: 0,
    });

    const result = await service.runSyntheticTest({ payload: 'payload sintetico' });

    expect(result.blockedReason).toBe('AI_PILOT_BUDGET_BLOCKED');
  });

  it('falls back locally when cloud provider is unavailable', async () => {
    const { service } = createService({
      cloudEnabled: true,
      provider: 'cloud',
      adminOptIn: true,
      dpoApproved: true,
      incidentAck: true,
      monthlyBudgetLimit: 10,
    }, { provider: { complete: vi.fn(async () => { throw new Error('cloud down'); }) } });

    const result = await service.runSyntheticTest({ payload: 'payload sintetico' });

    expect(result.ok).toBe(true);
    expect(result.status).toBe('fallback_local');
    expect(result.outputPreview).toContain('Fallback local');
  });

  it('exposes authenticated internal pilot routes', async () => {
    const { service } = createService();
    const app = createApp({
      inboundWebhookService: { process: vi.fn() } as never,
      metaAppSecret: 'meta-secret',
      metaVerifyToken: 'verify-token',
      outboundMessageService: { send: vi.fn() } as never,
      integrationServiceApiKey: apiKey,
      aiPilotService: service,
    });

    const unauthorized = await request(app).get('/internal/glpi/ai-pilot/status');
    const status = await request(app).get('/internal/glpi/ai-pilot/status').set('Authorization', `Bearer ${apiKey}`);
    const synthetic = await request(app)
      .post('/internal/glpi/ai-pilot/test')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ payload: 'payload sintetico' });

    expect(unauthorized.status).toBe(401);
    expect(status.status).toBe(200);
    expect(status.body.status.cloudEnabled).toBe(false);
    expect(synthetic.status).toBe(409);
    expect(synthetic.body.result.blockedReason).toBe('AI_PILOT_CLOUD_DISABLED');
  });
});
