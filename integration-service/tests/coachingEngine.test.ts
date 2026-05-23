import { describe, expect, it } from 'vitest';

import { generateCoachingRecommendations } from '../src/coaching/engine.js';

describe('coaching recommendation engine', () => {
  it('generates constructive recommendations with 7/15/30 onboarding plan', () => {
    const recommendations = generateCoachingRecommendations({
      scopeType: 'team',
      scopeLabel: 'Equipe Suporte',
      periodLabel: '30 dias',
      aiAnalysisCount: 30,
      averageClarity: 5.2,
      averageEmpathy: 5.8,
      averageCompleteness: 6.2,
      kbNotAlignedCount: 4,
      pendingKbCandidatesCount: 2,
      highRiskScoreCount: 1,
      relatedKbArticles: [{ articleId: 10, title: 'Ativacao Office', category: 'Office', internalUrl: '/front/knowbaseitem.form.php?id=10' }],
    });

    expect(recommendations.map((item) => item.recommendationType)).toContain('communication_skill');
    expect(recommendations.map((item) => item.recommendationType)).toContain('kb_study_suggestion');
    expect(recommendations[0].onboardingPlan.day7).not.toHaveLength(0);
    expect(recommendations[0].onboardingPlan.day15).not.toHaveLength(0);
    expect(recommendations[0].onboardingPlan.day30).not.toHaveLength(0);
    expect(recommendations.every((item) => item.status === 'active')).toBe(true);
    expect(recommendations.every((item) => item.explanationSanitized.length > 0)).toBe(true);
  });

  it('returns data quality warning for insufficient sample instead of judgement', () => {
    const recommendations = generateCoachingRecommendations({
      scopeType: 'queue',
      scopeLabel: 'Fila N1',
      periodLabel: '7 dias',
      aiAnalysisCount: 2,
    });

    expect(recommendations[0].recommendationType).toBe('data_quality_warning');
    expect(recommendations[0].summarySanitized).toContain('Amostra pequena');
    expect(recommendations[0].confidenceScore).toBeLessThanOrEqual(35);
  });

  it('sanitizes PII and secrets from generated text fields', () => {
    const recommendations = generateCoachingRecommendations({
      scopeType: 'category',
      scopeLabel: 'Cliente Bruno bruno@example.com token=abc123456789',
      periodLabel: '30 dias',
      aiAnalysisCount: 20,
      averageClarity: 4,
    });

    const serialized = JSON.stringify(recommendations);
    expect(serialized).not.toContain('bruno@example.com');
    expect(serialized).not.toContain('abc123456789');
    expect(serialized).toContain('[email]');
    expect(serialized).toContain('token=[redacted]');
  });
});
