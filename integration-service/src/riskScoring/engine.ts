import { createHash } from 'node:crypto';

import {
  RISK_SCORE_MODEL_VERSION,
  type PredictiveRiskLevel,
  type RiskScoreResult,
  type RiskScoringInput,
} from './types.js';

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalize(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function hasValue(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function levelFromScore(score: number, signalCount: number): PredictiveRiskLevel {
  if (signalCount < 4) {
    return 'unknown';
  }
  if (score >= 70) {
    return 'high';
  }
  if (score >= 40) {
    return 'medium';
  }
  return 'low';
}

function addSeverityPoints(value: string | null | undefined, low: number, medium: number, high: number): number {
  switch (normalize(value)) {
    case 'critical':
      return high + 8;
    case 'high':
      return high;
    case 'medium':
      return medium;
    case 'low':
      return low;
    default:
      return 0;
  }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

function inputHash(input: RiskScoringInput): string {
  return createHash('sha256')
    .update(JSON.stringify(stableValue(input)))
    .digest('hex');
}

function scoreId(input: RiskScoringInput, hash: string): string {
  const ticketPart = input.glpiTicketId && input.glpiTicketId > 0 ? `ticket:${input.glpiTicketId}` : 'ticket:none';
  const conversationPart = input.conversationId ? `conversation:${input.conversationId}` : 'conversation:none';
  return createHash('sha256')
    .update(`${RISK_SCORE_MODEL_VERSION}:${ticketPart}:${conversationPart}:${hash}`)
    .digest('hex')
    .slice(0, 32);
}

export function calculatePredictiveRiskScore(input: RiskScoringInput): RiskScoreResult {
  const reasons: string[] = [];
  const signalsUsed = new Set<string>();
  const warnings: string[] = [];

  let reopenScore = 0;
  let dissatisfactionScore = 0;
  let abandonmentScore = 0;

  const ai = input.aiQuality ?? {};
  if (hasValue(ai.riskLevel)) {
    signalsUsed.add('ai_quality.risk_level');
    const points = addSeverityPoints(ai.riskLevel, 4, 10, 18);
    reopenScore += Math.round(points * 0.5);
    dissatisfactionScore += points;
    if (points >= 10) {
      reasons.push(`IA Supervisora sinalizou risco ${normalize(ai.riskLevel)}.`);
    }
  }
  if (hasValue(ai.urgency)) {
    signalsUsed.add('ai_quality.urgency');
    const points = addSeverityPoints(ai.urgency, 2, 6, 14);
    reopenScore += Math.round(points * 0.6);
    abandonmentScore += Math.round(points * 0.4);
  }
  if (hasValue(ai.clientSatisfactionRisk)) {
    signalsUsed.add('ai_quality.client_satisfaction_risk');
    dissatisfactionScore += addSeverityPoints(ai.clientSatisfactionRisk, 4, 14, 28);
    reasons.push(`Risco de satisfação ${normalize(ai.clientSatisfactionRisk)} na análise IA.`);
  }
  if (hasValue(ai.sentiment)) {
    signalsUsed.add('ai_quality.sentiment');
    const sentiment = normalize(ai.sentiment);
    if (sentiment === 'frustrated') {
      dissatisfactionScore += 24;
      abandonmentScore += 8;
      reasons.push('Sentimento frustrado detectado.');
    } else if (sentiment === 'negative') {
      dissatisfactionScore += 16;
      reasons.push('Sentimento negativo detectado.');
    }
  }

  const communication = ai.communicationQuality ?? {};
  for (const [key, value] of Object.entries(communication)) {
    if (typeof value === 'number') {
      signalsUsed.add(`ai_quality.communication.${key}`);
      if (value <= 4) {
        dissatisfactionScore += 10;
        reasons.push(`Qualidade de comunicação baixa em ${key}.`);
      } else if (value <= 6) {
        dissatisfactionScore += 5;
      }
    }
  }

  const kbAlignment = normalize(ai.kbAlignment);
  if (kbAlignment) {
    signalsUsed.add('ai_quality.kb_alignment');
    if (kbAlignment === 'not_aligned') {
      reopenScore += 18;
      dissatisfactionScore += 8;
      reasons.push('Atendimento não alinhado ao procedimento documentado.');
    } else if (kbAlignment === 'no_article_found') {
      reopenScore += 8;
      reasons.push('Sem artigo de KB relacionado no contexto da análise.');
    } else if (kbAlignment === 'partially_aligned') {
      reopenScore += 8;
    }
  }

  const procedureFollowed = normalize(ai.procedureFollowed);
  if (procedureFollowed) {
    signalsUsed.add('ai_quality.procedure_followed');
    if (procedureFollowed === 'no') {
      reopenScore += 20;
      dissatisfactionScore += 8;
      reasons.push('Procedimento indicado não foi seguido.');
    } else if (procedureFollowed === 'partial' || procedureFollowed === 'unknown') {
      reopenScore += 10;
    }
  }

  if (Array.isArray(ai.missingContext) && ai.missingContext.length > 0) {
    signalsUsed.add('ai_quality.missing_context');
    reopenScore += Math.min(14, ai.missingContext.length * 4);
    reasons.push('Há lacunas de contexto antes da próxima resposta.');
  }
  if (Array.isArray(ai.riskFlags) && ai.riskFlags.length > 0) {
    signalsUsed.add('ai_quality.risk_flags');
    const points = Math.min(24, ai.riskFlags.length * 6);
    reopenScore += Math.round(points * 0.6);
    dissatisfactionScore += points;
  }
  if (Array.isArray(ai.qualityFlags) && ai.qualityFlags.length > 0) {
    signalsUsed.add('ai_quality.quality_flags');
    dissatisfactionScore += Math.min(16, ai.qualityFlags.length * 4);
  }

  const historical = input.historical ?? {};
  if (hasValue(historical.reopenPatternSeverity)) {
    signalsUsed.add('historical.reopen_pattern');
    reopenScore += addSeverityPoints(historical.reopenPatternSeverity, 6, 14, 24);
    reasons.push(`Histórico aponta padrão de reabertura ${historical.reopenPatternSeverity}.`);
  }
  if (hasValue(historical.dissatisfactionPatternSeverity)) {
    signalsUsed.add('historical.dissatisfaction_pattern');
    dissatisfactionScore += addSeverityPoints(historical.dissatisfactionPatternSeverity, 6, 14, 24);
  }
  if (typeof historical.reworkCategoryFrequency === 'number' && historical.reworkCategoryFrequency > 0) {
    signalsUsed.add('historical.rework_frequency');
    reopenScore += Math.min(18, historical.reworkCategoryFrequency);
  }

  const kb = input.kbCandidates ?? {};
  if (typeof kb.pendingCount === 'number' && kb.pendingCount > 0) {
    signalsUsed.add('kb_candidates.pending_count');
    reopenScore += Math.min(12, kb.pendingCount * 3);
    reasons.push('Existem candidatos de KB pendentes relacionados ao tema.');
  }
  if (typeof kb.possibleDuplicateCount === 'number' && kb.possibleDuplicateCount > 0) {
    signalsUsed.add('kb_candidates.possible_duplicate_count');
    reopenScore += Math.min(6, kb.possibleDuplicateCount * 2);
  }

  const sla = input.slaInactivity ?? {};
  if (hasValue(sla.slaState)) {
    signalsUsed.add('sla.state');
    if (normalize(sla.slaState) === 'violated') {
      abandonmentScore += 22;
      dissatisfactionScore += 10;
      reasons.push('SLA violado ou vencido.');
    } else if (normalize(sla.slaState) === 'risk') {
      abandonmentScore += 12;
    }
  }
  if (hasValue(sla.inactivityStatus)) {
    signalsUsed.add('inactivity.status');
    if (normalize(sla.inactivityStatus).includes('reminder')) {
      abandonmentScore += 12;
      reasons.push('Fluxo já entrou em lembrete de inatividade.');
    } else if (normalize(sla.inactivityStatus).includes('autoclose')) {
      abandonmentScore += 24;
      dissatisfactionScore += 8;
    }
  }
  if (typeof sla.minutesWithoutTechnicianResponse === 'number') {
    signalsUsed.add('inactivity.minutes_without_response');
    if (sla.minutesWithoutTechnicianResponse >= 240) {
      abandonmentScore += 24;
      reasons.push('Tempo sem resposta do técnico acima de 4 horas.');
    } else if (sla.minutesWithoutTechnicianResponse >= 60) {
      abandonmentScore += 12;
    }
  }

  const message = input.messageMetadata ?? {};
  if (typeof message.messageCount === 'number') {
    signalsUsed.add('message_metadata.message_count');
    if (message.messageCount >= 20) {
      reopenScore += 8;
      dissatisfactionScore += 6;
    }
  }
  if (typeof message.lastActivityAgeMinutes === 'number') {
    signalsUsed.add('message_metadata.last_activity_age');
    if (message.lastActivityAgeMinutes >= 720) {
      abandonmentScore += 18;
    } else if (message.lastActivityAgeMinutes >= 180) {
      abandonmentScore += 8;
    }
  }
  if (typeof message.reopenCount === 'number' && message.reopenCount > 0) {
    signalsUsed.add('message_metadata.reopen_count');
    reopenScore += Math.min(35, message.reopenCount * 18);
    reasons.push('Chamado possui histórico de reabertura.');
  }

  const csat = input.csat ?? {};
  if (hasValue(csat.rating)) {
    signalsUsed.add('csat.rating');
    const rating = normalize(csat.rating);
    if (rating.includes('dissatisfied') || rating === '1' || rating === '2') {
      dissatisfactionScore += 28;
      reasons.push('CSAT indica insatisfação.');
    }
  }
  if (csat.supervisorReviewRequired === true) {
    signalsUsed.add('csat.supervisor_review_required');
    dissatisfactionScore += 20;
  }

  const copilot = input.copilotFeedback ?? {};
  if (typeof copilot.negativeFeedbackCount === 'number' && copilot.negativeFeedbackCount > 0) {
    signalsUsed.add('copilot_feedback.negative_count');
    dissatisfactionScore += Math.min(12, copilot.negativeFeedbackCount * 4);
  }

  const signalCount = signalsUsed.size;
  if (signalCount < 4) {
    warnings.push('Dados insuficientes para predição robusta; use apenas como alerta fraco.');
  }

  const riskScore = signalCount < 4 ? 0 : clamp(Math.max(reopenScore, dissatisfactionScore, abandonmentScore));
  const confidenceScore = signalCount < 4 ? Math.max(10, signalCount * 10) : clamp(35 + signalCount * 7 - warnings.length * 10);
  const reopenRisk = levelFromScore(reopenScore, signalCount);
  const dissatisfactionRisk = levelFromScore(dissatisfactionScore, signalCount);
  const abandonmentRisk = levelFromScore(abandonmentScore, signalCount);
  const hash = inputHash(input);

  const uniqueReasons = Array.from(new Set(reasons)).slice(0, 6);
  const suggestedHumanAction = buildSuggestedAction(reopenRisk, dissatisfactionRisk, abandonmentRisk, signalCount);

  return {
    scoreId: scoreId(input, hash),
    conversationId: input.conversationId ?? null,
    glpiTicketId: input.glpiTicketId ?? null,
    modelVersion: RISK_SCORE_MODEL_VERSION,
    inputHash: hash,
    reopenRisk,
    dissatisfactionRisk,
    abandonmentRisk,
    riskScore,
    confidenceScore,
    reasons: uniqueReasons.length > 0 ? uniqueReasons : ['Sem sinais fortes suficientes para risco elevado.'],
    suggestedHumanAction,
    signalsUsed: Array.from(signalsUsed).sort(),
    dataQualityWarnings: warnings,
  };
}

function buildSuggestedAction(
  reopenRisk: PredictiveRiskLevel,
  dissatisfactionRisk: PredictiveRiskLevel,
  abandonmentRisk: PredictiveRiskLevel,
  signalCount: number,
): string {
  if (signalCount < 4) {
    return 'Revisar manualmente o contexto antes de usar o score para decisão.';
  }
  if ([reopenRisk, dissatisfactionRisk, abandonmentRisk].includes('high')) {
    return 'Supervisor ou técnico deve revisar o histórico, confirmar lacunas e responder de forma clara antes de avançar.';
  }
  if ([reopenRisk, dissatisfactionRisk, abandonmentRisk].includes('medium')) {
    return 'Técnico deve revisar procedimento, KB relacionada e próximos passos antes da resposta.';
  }
  return 'Manter acompanhamento normal e registrar feedback se o indicador parecer incorreto.';
}
