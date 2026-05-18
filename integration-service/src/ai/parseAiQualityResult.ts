import {
  AI_QUALITY_FLAGS,
  AI_QUALITY_RESOLUTIONS,
  AI_QUALITY_SENTIMENTS,
  type AiQualityFlag,
  type AiQualityResolution,
  type AiQualityResult,
  type AiQualitySentiment,
} from './aiQualityTypes.js';

function truncate(value: unknown, max: number): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function isResolution(value: unknown): value is AiQualityResolution {
  return AI_QUALITY_RESOLUTIONS.includes(value as AiQualityResolution);
}

function isSentiment(value: unknown): value is AiQualitySentiment {
  return AI_QUALITY_SENTIMENTS.includes(value as AiQualitySentiment);
}

function isFlag(value: unknown): value is AiQualityFlag {
  return AI_QUALITY_FLAGS.includes(value as AiQualityFlag);
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
  if (!isResolution(record.resolution) || !isSentiment(record.sentiment)) {
    throw new Error('AI_QUALITY_INVALID_CLASSIFICATION');
  }

  const flags = Array.isArray(record.flags)
    ? [...new Set(record.flags.filter(isFlag))]
    : [];

  return {
    summary: truncate(record.summary, 100),
    resolution: record.resolution,
    sentiment: record.sentiment,
    flags,
    recommendation: truncate(record.recommendation, 200),
  };
}
