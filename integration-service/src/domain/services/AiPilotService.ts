import { randomUUID } from 'node:crypto';

import type { CloudPilotProvider } from '../../cloud/providerRegistry.js';
import { LocalFallbackPilotProvider } from '../../cloud/providerRegistry.js';
import { anonymizeAiPilotPayload } from '../../privacy/anonymizeForAiPilot.js';
import type { AiPilotBudgetGuard } from '../../aiPilot/budgetGuard.js';
import type { AiPilotRepository } from '../../aiPilot/repository.js';
import type { AiPilotConfig, AiPilotRunInput, AiPilotRunResult, AiPilotStatus } from '../../aiPilot/types.js';
import type { AuditService } from './AuditService.js';

const SYNTHETIC_COST_ESTIMATE = 0.01;

export class AiPilotService {
  public constructor(
    private readonly config: AiPilotConfig,
    private readonly provider: CloudPilotProvider,
    private readonly budgetGuard: AiPilotBudgetGuard,
    private readonly repository: AiPilotRepository,
    private readonly auditService?: AuditService,
  ) {}

  public async getAsyncStatus(): Promise<Omit<AiPilotConfig, 'timeoutMs' | 'retryCount'> & {
    budget: { monthCost: number; monthlyLimit: number; remaining: number; blocked: boolean };
  }> {
    return {
      cloudEnabled: this.config.cloudEnabled,
      embeddingsEnabled: this.config.embeddingsEnabled,
      provider: this.config.provider,
      model: this.config.model,
      monthlyBudgetLimit: this.config.monthlyBudgetLimit,
      hardBudgetBlock: this.config.hardBudgetBlock,
      dpoApproved: this.config.dpoApproved,
      adminOptIn: this.config.adminOptIn,
      incidentAck: this.config.incidentAck,
      testEnvironmentOnly: this.config.testEnvironmentOnly,
      environment: this.config.environment,
      budget: await this.budgetGuard.getSnapshot(SYNTHETIC_COST_ESTIMATE),
    };
  }

  public async runSyntheticTest(input: AiPilotRunInput): Promise<AiPilotRunResult> {
    const requestId = randomUUID();
    const startedAt = Date.now();
    const sanitized = anonymizeAiPilotPayload(input.payload);
    const base = {
      requestId,
      provider: this.config.provider,
      model: this.config.model,
      estimatedCost: SYNTHETIC_COST_ESTIMATE,
      inputHash: sanitized.originalHash,
      anonymizedPayloadHash: sanitized.anonymizedPayloadHash,
      detectedKinds: sanitized.detectedKinds,
    };

    await this.audit('AI_CLOUD_PILOT_REQUESTED', 'pending', 'info', {
      request_id: requestId,
      provider: this.config.provider,
      model: this.config.model,
      input_hash: sanitized.originalHash,
      anonymized_payload_hash: sanitized.anonymizedPayloadHash,
      requested_by: input.requestedByGlpiUserId ?? null,
    });

    const blockedReason = this.evaluateGate(sanitized.blockedReason);
    if (blockedReason !== null) {
      await this.persistAndAuditBlocked(base, blockedReason, input.requestedByGlpiUserId ?? null);
      return {
        ok: false,
        status: 'blocked',
        blockedReason,
        latencyMs: Date.now() - startedAt,
        outputPreview: '',
        fallbackUsed: false,
        ...base,
      };
    }

    const budget = await this.budgetGuard.getSnapshot(SYNTHETIC_COST_ESTIMATE);
    if (budget.blocked) {
      await this.persistAndAuditBlocked(base, 'AI_PILOT_BUDGET_BLOCKED', input.requestedByGlpiUserId ?? null, 'AI_CLOUD_PILOT_BLOCKED_BUDGET');
      return {
        ok: false,
        status: 'blocked',
        blockedReason: 'AI_PILOT_BUDGET_BLOCKED',
        latencyMs: Date.now() - startedAt,
        outputPreview: '',
        fallbackUsed: false,
        ...base,
      };
    }

    let status: AiPilotStatus = 'completed';
    let outputPreview = '';
    let fallbackUsed = false;
    try {
      const response = await this.provider.complete({
        prompt: sanitized.text,
        model: this.config.model,
        timeoutMs: this.config.timeoutMs,
      });
      outputPreview = response.text.slice(0, 500);
    } catch {
      const fallback = await new LocalFallbackPilotProvider().complete({
        prompt: sanitized.text,
        model: this.config.model,
        timeoutMs: this.config.timeoutMs,
      });
      status = 'fallback_local';
      fallbackUsed = true;
      outputPreview = fallback.text.slice(0, 500);
    }

    const latencyMs = Date.now() - startedAt;
    await this.repository.recordUsage({
      requestId,
      provider: this.config.provider,
      model: this.config.model,
      operationType: 'synthetic_test',
      status,
      estimatedCost: SYNTHETIC_COST_ESTIMATE,
      actualCost: status === 'fallback_local' ? 0 : null,
      inputHash: sanitized.originalHash,
      anonymizedPayloadHash: sanitized.anonymizedPayloadHash,
      blockedReason: null,
      latencyMs,
      requestedByGlpiUserId: input.requestedByGlpiUserId ?? null,
    });
    await this.audit('AI_CLOUD_PILOT_COMPLETED', 'success', 'info', {
      request_id: requestId,
      provider: this.config.provider,
      model: this.config.model,
      estimated_cost: SYNTHETIC_COST_ESTIMATE,
      input_hash: sanitized.originalHash,
      anonymized_payload_hash: sanitized.anonymizedPayloadHash,
      latency_ms: latencyMs,
      fallback_used: fallbackUsed,
    });

    return {
      ok: true,
      status,
      blockedReason: null,
      latencyMs,
      outputPreview,
      fallbackUsed,
      ...base,
    };
  }

  private evaluateGate(payloadBlockedReason: string | null): string | null {
    if (payloadBlockedReason !== null) {
      return payloadBlockedReason;
    }
    if (this.config.testEnvironmentOnly && this.config.environment === 'production') {
      return 'AI_PILOT_PRODUCTION_DISABLED';
    }
    if (!this.config.cloudEnabled || this.config.provider === 'disabled') {
      return 'AI_PILOT_CLOUD_DISABLED';
    }
    if (!this.config.adminOptIn) {
      return 'AI_PILOT_ADMIN_OPT_IN_REQUIRED';
    }
    if (!this.config.dpoApproved) {
      return 'AI_PILOT_DPO_LGPD_APPROVAL_REQUIRED';
    }
    if (!this.config.incidentAck) {
      return 'AI_PILOT_INCIDENT_RESPONSE_ACK_REQUIRED';
    }
    return null;
  }

  private async persistAndAuditBlocked(
    base: {
      requestId: string;
      provider: string;
      model: string;
      estimatedCost: number;
      inputHash: string;
      anonymizedPayloadHash: string;
    },
    blockedReason: string,
    userId: number | null,
    auditEvent = blockedReason.includes('PII') || blockedReason.includes('REDACTION')
      ? 'AI_CLOUD_PILOT_BLOCKED_PII'
      : 'AI_CLOUD_PILOT_REQUESTED',
  ): Promise<void> {
    await this.repository.recordUsage({
      requestId: base.requestId,
      provider: base.provider,
      model: base.model,
      operationType: 'synthetic_test',
      status: 'blocked',
      estimatedCost: base.estimatedCost,
      actualCost: null,
      inputHash: base.inputHash,
      anonymizedPayloadHash: base.anonymizedPayloadHash,
      blockedReason,
      latencyMs: null,
      requestedByGlpiUserId: userId,
    });
    await this.audit(auditEvent, 'ignored', 'warning', {
      request_id: base.requestId,
      provider: base.provider,
      model: base.model,
      estimated_cost: base.estimatedCost,
      input_hash: base.inputHash,
      anonymized_payload_hash: base.anonymizedPayloadHash,
      blocked_reason: blockedReason,
      requested_by: userId,
    });
  }

  private async audit(
    eventType: string,
    status: 'success' | 'failed' | 'ignored' | 'pending',
    severity: 'info' | 'warning' | 'error',
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.auditService?.recordAuditEventSafe({
      eventType,
      status,
      severity,
      source: 'AiPilotService',
      payload,
    });
  }
}
