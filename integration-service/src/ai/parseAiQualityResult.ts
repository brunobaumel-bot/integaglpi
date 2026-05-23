import {
  AI_QUALITY_FLAGS,
  AI_QUALITY_CLIENT_SATISFACTION_RISKS,
  AI_QUALITY_COMMUNICATION_TONES,
  AI_QUALITY_KB_ALIGNMENTS,
  AI_QUALITY_PROCEDURE_FOLLOWED,
  AI_QUALITY_QUALITY_FLAGS,
  AI_QUALITY_RESOLUTIONS,
  AI_QUALITY_RISK_FLAGS,
  AI_QUALITY_RISK_LEVELS,
  AI_QUALITY_SENTIMENTS,
  AI_QUALITY_URGENCY_LEVELS,
  type AiQualityFlag,
  type AiQualityClientSatisfactionRisk,
  type AiQualityCommunicationTone,
  type AiQualityKbAlignment,
  type AiQualityQualityFlag,
  type AiQualityProcedureFollowed,
  type AiQualityResolution,
  type AiQualityResult,
  type AiQualityRiskFlag,
  type AiQualityRiskLevel,
  type AiQualitySentiment,
  type AiQualityUrgency,
} from './aiQualityTypes.js';
import { sanitizeAiQualityText } from './sanitizeAiQualityInput.js';

function truncate(value: unknown, max: number): string {
  return sanitizeAiQualityText(String(value ?? ''))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function isResolution(value: unknown): value is AiQualityResolution {
  return AI_QUALITY_RESOLUTIONS.includes(value as AiQualityResolution);
}

function isSentiment(value: unknown): value is AiQualitySentiment {
  return AI_QUALITY_SENTIMENTS.includes(value as AiQualitySentiment);
}

function isUrgency(value: unknown): value is AiQualityUrgency {
  return AI_QUALITY_URGENCY_LEVELS.includes(value as AiQualityUrgency);
}

function isRiskLevel(value: unknown): value is AiQualityRiskLevel {
  return AI_QUALITY_RISK_LEVELS.includes(value as AiQualityRiskLevel);
}

function isRiskFlag(value: unknown): value is AiQualityRiskFlag {
  return AI_QUALITY_RISK_FLAGS.includes(value as AiQualityRiskFlag);
}

function isQualityFlag(value: unknown): value is AiQualityQualityFlag {
  return AI_QUALITY_QUALITY_FLAGS.includes(value as AiQualityQualityFlag);
}

function isFlag(value: unknown): value is AiQualityFlag {
  return AI_QUALITY_FLAGS.includes(value as AiQualityFlag);
}

function isKbAlignment(value: unknown): value is AiQualityKbAlignment {
  return AI_QUALITY_KB_ALIGNMENTS.includes(value as AiQualityKbAlignment);
}

function isProcedureFollowed(value: unknown): value is AiQualityProcedureFollowed {
  return AI_QUALITY_PROCEDURE_FOLLOWED.includes(value as AiQualityProcedureFollowed);
}

function isCommunicationTone(value: unknown): value is AiQualityCommunicationTone {
  return AI_QUALITY_COMMUNICATION_TONES.includes(value as AiQualityCommunicationTone);
}

function isClientSatisfactionRisk(value: unknown): value is AiQualityClientSatisfactionRisk {
  return AI_QUALITY_CLIENT_SATISFACTION_RISKS.includes(value as AiQualityClientSatisfactionRisk);
}

function truncateStringArray(value: unknown, maxItems: number, maxChars: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => truncate(item, maxChars))
    .filter((item) => item !== '')
    .slice(0, maxItems);
}

function clampScore(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, Math.round(value)));
}

function normalizeRelatedKbArticles(
  value: unknown,
  allowedKbArticleIds: Set<number> | null,
): AiQualityResult['relatedKbArticles'] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.slice(0, 5).map((item) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('AI_QUALITY_INVALID_KB_ARTICLE');
    }

    const record = item as Record<string, unknown>;
    const articleId = Number(record.article_id ?? record.articleId ?? 0);
    if (!Number.isInteger(articleId) || articleId <= 0) {
      throw new Error('AI_QUALITY_INVALID_KB_ARTICLE');
    }
    if (allowedKbArticleIds !== null && !allowedKbArticleIds.has(articleId)) {
      throw new Error('AI_QUALITY_UNKNOWN_KB_ARTICLE');
    }

    return {
      articleId,
      title: truncate(record.title, 180),
      category: truncate(record.category, 120),
      relevanceScore: clampScore(record.relevance_score ?? record.relevanceScore, 0, 100, 0),
      whyRelevant: truncate(record.why_relevant ?? record.whyRelevant, 160),
      internalUrl: truncate(record.internal_url ?? record.internalUrl, 300),
    };
  });
}

function normalizeCommunicationQuality(value: unknown): AiQualityResult['communicationQuality'] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('AI_QUALITY_INVALID_COMMUNICATION_QUALITY');
  }

  const record = value as Record<string, unknown>;
  if (!isCommunicationTone(record.tone)) {
    throw new Error('AI_QUALITY_INVALID_COMMUNICATION_QUALITY');
  }

  return {
    clarity: clampScore(record.clarity, 1, 10, 1),
    empathy: clampScore(record.empathy, 1, 10, 1),
    completeness: clampScore(record.completeness, 1, 10, 1),
    tone: record.tone,
  };
}

function normalizeProbableCause(value: unknown): string {
  const probableCause = truncate(value, 160);
  if (probableCause === '') {
    return 'Não identificado com segurança';
  }

  if (/^não identificado/i.test(probableCause) || /^hip[oó]tese:/i.test(probableCause)) {
    return probableCause;
  }

  return `Hipótese: ${probableCause}`.slice(0, 160);
}

function assertSafeSuggestion(value: string): void {
  if (/\b(enviei|fechei|alterei|mudei|criei|reabri|aprovei|executei|acionar template|enviar whatsapp|mudar entidade)\b/i.test(value)) {
    throw new Error('AI_QUALITY_UNSAFE_ACTION');
  }
}

function deriveLegacyResolution(record: Record<string, unknown>, riskLevel: AiQualityRiskLevel): AiQualityResolution {
  if (isResolution(record.resolution)) {
    return record.resolution;
  }

  return riskLevel === 'low' ? 'probably_resolved' : 'uncertain';
}

function deriveLegacyFlags(
  record: Record<string, unknown>,
  riskFlags: AiQualityRiskFlag[],
  qualityFlags: AiQualityQualityFlag[],
): AiQualityFlag[] {
  const explicitFlags = Array.isArray(record.flags) ? record.flags.filter(isFlag) : [];
  const mappedFlags: AiQualityFlag[] = [];

  if (riskFlags.includes('customer_frustrated')) {
    mappedFlags.push('customer_dissatisfied');
  }
  if (riskFlags.includes('sla_risk') || qualityFlags.includes('delayed_response')) {
    mappedFlags.push('long_delay');
  }
  if (qualityFlags.includes('poor_tone')) {
    mappedFlags.push('poor_tone');
  }
  if (qualityFlags.includes('unclear_instructions') || qualityFlags.includes('insufficient_resolution')) {
    mappedFlags.push('unclear_resolution');
  }
  if (qualityFlags.includes('supervisor_review_required') || riskFlags.length > 0) {
    mappedFlags.push('supervisor_review_required');
  }

  return [...new Set([...explicitFlags, ...mappedFlags])];
}

export function parseAiQualityResult(raw: string): AiQualityResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('AI_QUALITY_INVALID_JSON');
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('AI_QUALITY_INVALID_SHAPE');
  }

  const record = parsed as Record<string, unknown>;
  if (
    typeof record.summary !== 'string'
    || typeof record.probable_cause !== 'string'
    || typeof record.suggested_next_action !== 'string'
  ) {
    throw new Error('AI_QUALITY_INVALID_SHAPE');
  }

  if (!isSentiment(record.sentiment) || !isUrgency(record.urgency) || !isRiskLevel(record.risk_level)) {
    throw new Error('AI_QUALITY_INVALID_CLASSIFICATION');
  }

  if (
    !isKbAlignment(record.kb_alignment)
    || !isProcedureFollowed(record.procedure_followed)
    || !isClientSatisfactionRisk(record.client_satisfaction_risk)
  ) {
    throw new Error('AI_QUALITY_INVALID_CLASSIFICATION');
  }

  if (typeof record.confidence_score !== 'number' || !Number.isFinite(record.confidence_score)) {
    throw new Error('AI_QUALITY_INVALID_CONFIDENCE');
  }

  const confidenceScore = Math.max(0, Math.min(100, Math.round(record.confidence_score)));
  const riskFlags = Array.isArray(record.risk_flags)
    ? [...new Set(record.risk_flags.filter(isRiskFlag))]
    : [];
  const qualityFlags = Array.isArray(record.quality_flags)
    ? [...new Set(record.quality_flags.filter(isQualityFlag))]
    : [];
  const suggestedNextAction = truncate(record.suggested_next_action, 200);
  assertSafeSuggestion(suggestedNextAction);
  const suggestedImprovementsForTechnician = truncateStringArray(record.suggested_improvements_for_technician, 3, 160);
  const supervisorRecommendation = truncateStringArray(record.supervisor_recommendation, 3, 160);
  [...suggestedImprovementsForTechnician, ...supervisorRecommendation].forEach(assertSafeSuggestion);
  const allowedKbArticleIds = Array.isArray(record._allowed_kb_article_ids)
    ? new Set(record._allowed_kb_article_ids.map(Number).filter((id) => Number.isInteger(id) && id > 0))
    : null;
  const relatedKbArticles = normalizeRelatedKbArticles(record.related_kb_articles, allowedKbArticleIds);
  if (relatedKbArticles.length > 0 && record.kb_alignment === 'no_article_found') {
    throw new Error('AI_QUALITY_KB_ALIGNMENT_CONFLICT');
  }
  const riskLevel = record.risk_level;
  const resolution = deriveLegacyResolution(record, riskLevel);
  const flags = deriveLegacyFlags(record, riskFlags, qualityFlags);

  return {
    summary: truncate(record.summary, 500),
    resolution,
    sentiment: record.sentiment,
    urgency: record.urgency,
    riskLevel,
    riskFlags,
    qualityFlags,
    missingContext: truncateStringArray(record.missing_context, 10, 120),
    probableCause: normalizeProbableCause(record.probable_cause),
    suggestedNextAction,
    supervisorNotes: truncate(record.supervisor_notes, 300),
    confidenceScore,
    safetyNotes: truncateStringArray(record.safety_notes, 8, 140),
    flags,
    recommendation: suggestedNextAction,
    relatedKbArticles,
    kbAlignment: record.kb_alignment,
    procedureFollowed: record.procedure_followed,
    procedureNotes: truncate(record.procedure_notes, 240),
    communicationQuality: normalizeCommunicationQuality(record.communication_quality),
    clientSatisfactionRisk: record.client_satisfaction_risk,
    keyInsights: truncateStringArray(record.key_insights, 3, 160),
    suggestedImprovementsForTechnician,
    supervisorRecommendation,
  };
}
