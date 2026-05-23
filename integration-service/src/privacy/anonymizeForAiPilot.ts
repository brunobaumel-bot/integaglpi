import { createHash } from 'node:crypto';

export const AI_PILOT_PII_PATTERNS = [
  'email',
  'phone',
  'cpf_cnpj',
  'name',
  'ip',
  'domain',
  'token_url',
  'secret',
  'base64',
] as const;

export type AiPilotDetectedKind = typeof AI_PILOT_PII_PATTERNS[number];

export interface AiPilotAnonymizationResult {
  originalHash: string;
  anonymizedPayloadHash: string;
  text: string;
  detectedKinds: AiPilotDetectedKind[];
  blocked: boolean;
  blockedReason: string | null;
}

const MAX_TEXT_CHARS = 6_000;

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function mark(detected: Set<AiPilotDetectedKind>, kind: AiPilotDetectedKind): void {
  detected.add(kind);
}

function replacePattern(
  text: string,
  pattern: RegExp,
  replacement: string,
  detected: Set<AiPilotDetectedKind>,
  kind: AiPilotDetectedKind,
): string {
  if (pattern.test(text)) {
    mark(detected, kind);
  }
  pattern.lastIndex = 0;
  return text.replace(pattern, replacement);
}

export function anonymizeAiPilotPayload(input: string): AiPilotAnonymizationResult {
  const original = String(input ?? '').slice(0, MAX_TEXT_CHARS * 2);
  const detected = new Set<AiPilotDetectedKind>();
  let text = original;

  text = replacePattern(text, /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gi, '[private_key]', detected, 'secret');
  text = replacePattern(text, /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi, 'Bearer [redacted]', detected, 'secret');
  text = replacePattern(text, /\b(password|passwd|senha|token|api[_-]?key|app[_-]?secret|secret)\s*[:=]\s*['"]?[^'"\s,;]{4,}/gi, '$1=[redacted]', detected, 'secret');
  text = replacePattern(text, /https?:\/\/[^\s<>"']*(?:token|access_token|key|secret|sig|signature)=[^\s<>"']+/gi, '[token_url]', detected, 'token_url');
  text = replacePattern(text, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]', detected, 'email');
  text = replacePattern(text, /\b(nome|cliente|contato|solicitante)\s*(?::|=)?\s*[A-ZÀ-Ý][a-zà-ÿ]+(?:\s+[A-ZÀ-Ý][a-zà-ÿ]+){0,3}/gi, '$1: [nome]', detected, 'name');
  text = replacePattern(text, /\b(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?(?:9\s?)?\d{4}[-.\s]?\d{4}\b/g, '[telefone]', detected, 'phone');
  text = replacePattern(text, /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, '[documento]', detected, 'cpf_cnpj');
  text = replacePattern(text, /\b(?:10|172\.(?:1[6-9]|2\d|3[0-1])|192\.168)\.\d{1,3}\.\d{1,3}\b/g, '[ip_privado]', detected, 'ip');
  text = replacePattern(text, /\b(?:[a-z0-9-]+\.)+(?:local|lan|corp|internal|intra|eticainformatica\.com\.br)\b/gi, '[dominio_interno]', detected, 'domain');
  text = replacePattern(text, /\b(?:[A-Za-z0-9+/]{80,}={0,2})\b/g, '[base64]', detected, 'base64');
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '[script_removed]');
  text = text.replace(/<iframe[\s\S]*?<\/iframe>/gi, '[iframe_removed]');
  text = text.replace(/data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi, '[image_base64]');
  text = text.replace(/<[^>]+>/g, ' ');
  text = text.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_CHARS);

  const residualSecret = /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(password|senha|token|api[_-]?key|app[_-]?secret)\s*[:=]\s*[^,\s]+/i.test(text);
  const blocked = residualSecret || detected.size > 0;

  return {
    originalHash: hash(original),
    anonymizedPayloadHash: hash(text),
    text,
    detectedKinds: [...detected].sort(),
    blocked,
    blockedReason: blocked ? 'AI_PILOT_PAYLOAD_BLOCKED_PII_OR_SECRET' : null,
  };
}
