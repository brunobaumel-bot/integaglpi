import { describe, expect, it, vi } from 'vitest';

import { calculatePredictiveRiskScore } from '../src/riskScoring/engine.js';
import { RiskScoringService } from '../src/domain/services/RiskScoringService.js';
import { persistRiskScore } from '../src/riskScoring/repository.js';

describe('predictive risk scoring engine', () => {
  it('calculates deterministic high risk with reasons, signals, hash and model version', () => {
    const input = {
      conversationId: 'conv-risk-1',
      glpiTicketId: 2112319301,
      aiQuality: {
        riskLevel: 'high',
        urgency: 'high',
        sentiment: 'frustrated',
        clientSatisfactionRisk: 'high',
        communicationQuality: { clarity: 3, empathy: 4, completeness: 5 },
        kbAlignment: 'not_aligned',
        procedureFollowed: 'no',
        missingContext: ['licenca', 'versao'],
        riskFlags: ['cliente_frustrado'],
        qualityFlags: ['resposta_confusa'],
      },
      historical: {
        reopenPatternSeverity: 'high' as const,
        dissatisfactionPatternSeverity: 'medium' as const,
        reworkCategoryFrequency: 8,
      },
      kbCandidates: { pendingCount: 3, possibleDuplicateCount: 1 },
      slaInactivity: { slaState: 'risk', inactivityStatus: 'reminder_1_sent', minutesWithoutTechnicianResponse: 90 },
      messageMetadata: { messageCount: 24, lastActivityAgeMinutes: 220, reopenCount: 1 },
      csat: { rating: 'dissatisfied', supervisorReviewRequired: true },
    };

    const first = calculatePredictiveRiskScore(input);
    const second = calculatePredictiveRiskScore(input);

    expect(first).toEqual(second);
    expect(first.modelVersion).toBe('risk_score_v1_2026_05');
    expect(first.inputHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.riskScore).toBeGreaterThanOrEqual(70);
    expect(first.reopenRisk).toBe('high');
    expect(first.dissatisfactionRisk).toBe('high');
    expect(first.abandonmentRisk).not.toBe('unknown');
    expect(first.confidenceScore).toBeGreaterThan(70);
    expect(first.reasons.length).toBeGreaterThan(0);
    expect(first.signalsUsed).toContain('ai_quality.client_satisfaction_risk');
  });

  it('changes input_hash when nested signal values change', () => {
    const base = calculatePredictiveRiskScore({
      conversationId: 'conv-hash',
      glpiTicketId: 10,
      aiQuality: {
        clientSatisfactionRisk: 'medium',
        sentiment: 'negative',
        communicationQuality: { clarity: 5, empathy: 5, completeness: 5 },
      },
      messageMetadata: { messageCount: 5, lastActivityAgeMinutes: 10, reopenCount: 0 },
    });
    const changed = calculatePredictiveRiskScore({
      conversationId: 'conv-hash',
      glpiTicketId: 10,
      aiQuality: {
        clientSatisfactionRisk: 'high',
        sentiment: 'negative',
        communicationQuality: { clarity: 5, empathy: 5, completeness: 5 },
      },
      messageMetadata: { messageCount: 5, lastActivityAgeMinutes: 10, reopenCount: 0 },
    });

    expect(changed.inputHash).not.toBe(base.inputHash);
    expect(changed.scoreId).not.toBe(base.scoreId);
  });

  it('returns unknown and low confidence when data is insufficient', () => {
    const result = calculatePredictiveRiskScore({
      conversationId: 'conv-risk-2',
      glpiTicketId: 2,
      aiQuality: { sentiment: 'neutral' },
    });

    expect(result.reopenRisk).toBe('unknown');
    expect(result.dissatisfactionRisk).toBe('unknown');
    expect(result.abandonmentRisk).toBe('unknown');
    expect(result.riskScore).toBe(0);
    expect(result.confidenceScore).toBeLessThan(40);
    expect(result.dataQualityWarnings.join(' ')).toContain('Dados insuficientes');
  });

  it('uses the domain service without operational dependencies', () => {
    const service = new RiskScoringService();
    const result = service.score({
      conversationId: 'conv-service',
      glpiTicketId: 3,
      aiQuality: {
        clientSatisfactionRisk: 'medium',
        sentiment: 'negative',
        communicationQuality: { clarity: 5, empathy: 5, completeness: 5 },
        kbAlignment: 'partially_aligned',
      },
      messageMetadata: { messageCount: 3, lastActivityAgeMinutes: 5, reopenCount: 0 },
    });

    expect(['low', 'medium', 'high', 'unknown']).toContain(result.dissatisfactionRisk);
    expect(result.suggestedHumanAction).toContain('Técnico');
  });

  it('persists score and sanitized audit payload without WhatsApp or ticket mutation', async () => {
    const queries: Array<{ text: string; params?: unknown[] }> = [];
    const executor = {
      query: vi.fn(async (text: string, params?: unknown[]) => {
        queries.push({ text, params });
        return { rows: [], rowCount: 1, command: 'INSERT', oid: 0, fields: [] };
      }),
    };
    const result = calculatePredictiveRiskScore({
      conversationId: 'conv-persist',
      glpiTicketId: 4,
      aiQuality: {
        riskLevel: 'high',
        clientSatisfactionRisk: 'medium',
        sentiment: 'negative',
        communicationQuality: { clarity: 4, empathy: 5, completeness: 4 },
      },
      messageMetadata: { messageCount: 10, lastActivityAgeMinutes: 15, reopenCount: 0 },
    });

    await persistRiskScore(executor, result);

    const sql = queries.map((query) => query.text).join('\n');
    expect(sql).toContain('glpi_plugin_integaglpi_risk_scores');
    expect(sql).toContain('RISK_SCORE_GENERATED');
    expect(sql).not.toMatch(/sendOutbound|MetaClient|UPDATE\s+glpi_tickets|priority|status\s*=/i);
  });
});
