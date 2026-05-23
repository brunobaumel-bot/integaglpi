import {
  AI_QUALITY_FLAGS,
  AI_QUALITY_QUALITY_FLAGS,
  AI_QUALITY_RESOLUTIONS,
  AI_QUALITY_RISK_FLAGS,
  AI_QUALITY_RISK_LEVELS,
  AI_QUALITY_SENTIMENTS,
  AI_QUALITY_URGENCY_LEVELS,
  type AiQualityFlag,
  type AiQualityQualityFlag,
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

function truncateStringArray(value: unknown, maxItems: number, maxChars: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => truncate(item, maxChars))
    .filter((item) => item !== '')
    .slice(0, maxItems);
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
  };
}
