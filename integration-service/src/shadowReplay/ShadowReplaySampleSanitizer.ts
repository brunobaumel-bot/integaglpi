/**
 * V10 Shadow Replay Lab G6 - pure sanitizer for synthetic sample envelopes.
 *
 * This module intentionally uses only local contracts/types. It must stay
 * deterministic and free of I/O so it can be audited before any future Shadow
 * Replay runtime exists.
 */

import type {
  ShadowReplayRedactionKind,
  ShadowReplaySampleEnvelope,
  ShadowReplaySampleEnvelopeInput,
  ShadowReplaySanitizationReport,
} from './ShadowReplaySampleEnvelope.js';
import { SHADOW_REPLAY_SAMPLE_ENVELOPE_SCHEMA_VERSION } from './ShadowReplaySampleEnvelope.js';
import type { ShadowReplaySanitizedMetadata, ShadowReplaySanitizedValue } from './ShadowReplayStoreTypes.js';

const MAX_SUMMARY_CHARS = 1200;
const MAX_METADATA_DEPTH = 4;
const MAX_METADATA_STRING_CHARS = 300;
const HASH_RE = /^[a-f0-9]{64}$/;

const REDACTION_KINDS: readonly ShadowReplayRedactionKind[] = [
  'email',
  'phone',
  'cpf_cnpj',
  'token',
  'url_secret',
  'ticket_protocol',
  'person_name',
  'private_key',
  'base64',
  'html',
] as const;

const BLOCKING_INPUT_KEY_RE = /(^|_)(raw|payload|payload_json|raw_payload|transcript|messages?|body|body_text|message_text)(_|$)/i;
const FORBIDDEN_METADATA_KEY_RE =
  /(^|_)(raw|payload|payload_json|raw_payload|transcript|messages?|body|body_text|message_text|phone|telefone|email|e_mail|mail|cpf|cnpj|documento|ticket_id|ticket|protocolo|protocol|name|nome|cliente|solicitante|requester|whatsapp|token|secret|api[_-]?key|password|senha|chave)(_|$)/i;

const RESIDUAL_PII_RE =
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\b(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?(?:9\s?)?\d{4}[-.\s]?\d{4}\b|\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b|\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:password|senha|token|api[_-]?key|app[_-]?secret|secret|chave)\s*[:=]\s*['"]?[^'"\s,;]{4,}/i;

function emptyCounts(): Record<ShadowReplayRedactionKind, number> {
  return REDACTION_KINDS.reduce<Record<ShadowReplayRedactionKind, number>>((acc, kind) => {
    acc[kind] = 0;
    return acc;
  }, {} as Record<ShadowReplayRedactionKind, number>);
}

function addCount(counts: Record<ShadowReplayRedactionKind, number>, kind: ShadowReplayRedactionKind, count: number): void {
  if (count > 0) {
    counts[kind] += count;
  }
}

function replaceCount(
  input: string,
  pattern: RegExp,
  replacement: string | ((match: string) => string),
): { text: string; count: number } {
  let count = 0;
  const text = input.replace(pattern, (match) => {
    count += 1;
    return typeof replacement === 'function' ? replacement(match) : replacement;
  });
  return { text, count };
}

function mergeCounts(
  target: Record<ShadowReplayRedactionKind, number>,
  source: Readonly<Record<ShadowReplayRedactionKind, number>>,
): void {
  for (const kind of REDACTION_KINDS) {
    target[kind] += source[kind] ?? 0;
  }
}

export function hashShadowReplayReference(value: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= code + index;
    h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
  }
  const seed = `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
  return (seed.repeat(4)).slice(0, 64);
}

export function sanitizeShadowReplayText(input: string, maxChars = MAX_SUMMARY_CHARS): {
  readonly text: string;
  readonly counts: Readonly<Record<ShadowReplayRedactionKind, number>>;
  readonly truncated: boolean;
  readonly residualPiiDetected: boolean;
} {
  const counts = emptyCounts();
  let text = String(input ?? '');

  let result = replaceCount(text, /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gi, '[private_key_redacted]');
  text = result.text;
  addCount(counts, 'private_key', result.count);

  result = replaceCount(text, /\b(?:[A-Za-z0-9+/]{80,}={0,2})\b/g, '[base64_redacted]');
  text = result.text;
  addCount(counts, 'base64', result.count);

  result = replaceCount(text, /https?:\/\/[^\s<>"']*(?:access_token|token|api[_-]?key|key|secret|sig|signature|password|senha)=[^\s<>"']+/gi, '[url_secret_redacted]');
  text = result.text;
  addCount(counts, 'url_secret', result.count);

  result = replaceCount(text, /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi, 'Bearer [token_redacted]');
  text = result.text;
  addCount(counts, 'token', result.count);

  result = replaceCount(text, /\b(?:password|senha|token|api[_-]?key|app[_-]?secret|secret|chave)\s*[:=]\s*['"]?[^'"\s,;]{4,}/gi, '[token_redacted]');
  text = result.text;
  addCount(counts, 'token', result.count);

  result = replaceCount(text, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email_redacted]');
  text = result.text;
  addCount(counts, 'email', result.count);

  result = replaceCount(text, /\b(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?(?:9\s?)?\d{4}[-.\s]?\d{4}\b/g, '[phone_redacted]');
  text = result.text;
  addCount(counts, 'phone', result.count);

  result = replaceCount(text, /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, '[document_redacted]');
  text = result.text;
  addCount(counts, 'cpf_cnpj', result.count);

  result = replaceCount(text, /\b(?:ticket|chamado|protocolo|protocolo\s+glpi|glpi)\s*#?\s*\d{4,}\b/gi, '[ticket_ref_redacted]');
  text = result.text;
  addCount(counts, 'ticket_protocol', result.count);

  result = replaceCount(text, /\b(?:nome|cliente|contato|solicitante|t[eé]cnico)\s*(?::|=)?\s*[A-ZÀ-Ý][a-zà-ÿ]+(?:\s+[A-ZÀ-Ý][a-zà-ÿ]+){0,3}/g, (match) => {
    const key = match.split(/[:=]/)[0]?.trim() || 'nome';
    return `${key}: [name_redacted]`;
  });
  text = result.text;
  addCount(counts, 'person_name', result.count);

  result = replaceCount(text, /<script[\s\S]*?<\/script>|<iframe[\s\S]*?<\/iframe>|<[^>]+>/gi, ' ');
  text = result.text;
  addCount(counts, 'html', result.count);

  text = text.replace(/\s+/g, ' ').trim();
  const truncated = text.length > maxChars;
  if (truncated) {
    text = text.slice(0, maxChars).trim();
  }

  return {
    text,
    counts,
    truncated,
    residualPiiDetected: RESIDUAL_PII_RE.test(text),
  };
}

function collectForbiddenKeys(value: unknown, path = '$', found: string[] = []): string[] {
  if (!value || typeof value !== 'object') {
    return found;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${path}.${key}`;
    if (BLOCKING_INPUT_KEY_RE.test(key)) {
      found.push(childPath);
    }
    collectForbiddenKeys(child, childPath, found);
  }
  return found;
}

function sanitizeMetadataValue(
  value: unknown,
  counts: Record<ShadowReplayRedactionKind, number>,
  truncatedFields: string[],
  path: string,
  depth: number,
): ShadowReplaySanitizedValue {
  if (depth > MAX_METADATA_DEPTH) {
    truncatedFields.push(path);
    return '[max_depth_redacted]';
  }
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const sanitized = sanitizeShadowReplayText(value, MAX_METADATA_STRING_CHARS);
    mergeCounts(counts, sanitized.counts);
    if (sanitized.truncated) {
      truncatedFields.push(path);
    }
    return sanitized.text;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item, index) => sanitizeMetadataValue(item, counts, truncatedFields, `${path}[${index}]`, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, ShadowReplaySanitizedValue> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_METADATA_KEY_RE.test(key)) {
        continue;
      }
      out[key] = sanitizeMetadataValue(child, counts, truncatedFields, `${path}.${key}`, depth + 1);
    }
    return out;
  }
  return null;
}

function sanitizeMetadata(
  value: unknown,
  counts: Record<ShadowReplayRedactionKind, number>,
  truncatedFields: string[],
  path: string,
): ShadowReplaySanitizedMetadata {
  const sanitized = sanitizeMetadataValue(value ?? {}, counts, truncatedFields, path, 0);
  if (sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)) {
    return sanitized as ShadowReplaySanitizedMetadata;
  }
  return {};
}

export function createShadowReplaySampleEnvelope(input: ShadowReplaySampleEnvelopeInput): ShadowReplaySampleEnvelope {
  const forbiddenKeys = collectForbiddenKeys(input);
  if (forbiddenKeys.length > 0) {
    throw new Error(`Shadow Replay sample input contains forbidden raw keys: ${forbiddenKeys.join(', ')}`);
  }

  const redacted = emptyCounts();
  const truncatedFields: string[] = [];

  const problem = sanitizeShadowReplayText(input.problem_summary);
  mergeCounts(redacted, problem.counts);
  if (problem.truncated) {
    truncatedFields.push('sanitized_problem_summary');
  }

  const technical = sanitizeShadowReplayText(input.technical_summary ?? '');
  mergeCounts(redacted, technical.counts);
  if (technical.truncated) {
    truncatedFields.push('sanitized_technical_summary');
  }

  const classification = sanitizeMetadata(input.classification ?? {}, redacted, truncatedFields, 'classification_metadata');
  const metadata = sanitizeMetadata(input.metadata ?? {}, redacted, truncatedFields, 'sanitized_metadata');

  const redaction_report: ShadowReplaySanitizationReport = {
    redacted,
    truncated_fields: truncatedFields,
    forbidden_keys: forbiddenKeys,
    residual_pii_detected: problem.residualPiiDetected || technical.residualPiiDetected,
  };

  return {
    schema_version: SHADOW_REPLAY_SAMPLE_ENVELOPE_SCHEMA_VERSION,
    run_id: input.run_id,
    sample_id: input.sample_id,
    source_kind: input.source_kind,
    source_ref_hash: HASH_RE.test(input.source_ref) ? input.source_ref : hashShadowReplayReference(input.source_ref),
    sanitized_problem_summary: problem.text,
    sanitized_technical_summary: technical.text,
    classification_metadata: classification,
    sanitized_metadata: metadata,
    redaction_report,
    observed_at: input.observed_at ?? null,
    created_at: input.created_at ?? new Date(0).toISOString(),
  };
}

export const SHADOW_REPLAY_SAMPLE_SANITIZER_FORBIDDEN_KEY_RE = FORBIDDEN_METADATA_KEY_RE;
export const SHADOW_REPLAY_SAMPLE_RESIDUAL_PII_RE = RESIDUAL_PII_RE;
