import { createHash } from 'node:crypto';

import type { ExternalResearchSanitizationResult } from './types.js';

const MAX_PROMPT_CHARS = 4_000;

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function replaceAndMark(text: string, pattern: RegExp, replacement: string, detected: Set<string>, kind: string): string {
  if (pattern.test(text)) {
    detected.add(kind);
  }
  pattern.lastIndex = 0;
  return text.replace(pattern, replacement);
}

export function sanitizeExternalResearchPrompt(input: string): ExternalResearchSanitizationResult {
  const original = String(input ?? '').slice(0, MAX_PROMPT_CHARS * 2);
  const detected = new Set<string>();
  let sanitized = original;

  sanitized = replaceAndMark(sanitized, /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gi, '[private_key]', detected, 'private_key');
  sanitized = replaceAndMark(sanitized, /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi, 'Bearer [redacted]', detected, 'bearer');
  sanitized = replaceAndMark(sanitized, /\b(password|passwd|senha|token|api[_-]?key|app[_-]?secret|secret|chave)\s*[:=]\s*['"]?[^'"\s,;]{4,}/gi, '$1=[redacted]', detected, 'secret');
  sanitized = replaceAndMark(sanitized, /https?:\/\/[^\s<>"']*(?:token|access_token|key|secret|sig|signature)=[^\s<>"']+/gi, '[token_url]', detected, 'token_url');
  sanitized = replaceAndMark(sanitized, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]', detected, 'email');
  sanitized = replaceAndMark(sanitized, /\b(nome|cliente|contato|solicitante|tecnico|técnico)\s*(?::|=)?\s*[A-ZÀ-Ý][a-zà-ÿ]+(?:\s+[A-ZÀ-Ý][a-zà-ÿ]+){0,3}/gi, '$1: [nome]', detected, 'name');
  sanitized = replaceAndMark(sanitized, /\b(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?(?:9\s?)?\d{4}[-.\s]?\d{4}\b/g, '[telefone]', detected, 'phone');
  sanitized = replaceAndMark(sanitized, /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, '[documento]', detected, 'cpf_cnpj');
  sanitized = replaceAndMark(sanitized, /\b(?:10|172\.(?:1[6-9]|2\d|3[0-1])|192\.168)\.\d{1,3}\.\d{1,3}\b/g, '[ip_privado]', detected, 'ip');
  sanitized = replaceAndMark(sanitized, /\b(?:[a-z0-9-]+\.)+(?:local|lan|corp|internal|intra|eticainformatica\.com\.br)\b/gi, '[dominio_interno]', detected, 'domain');
  sanitized = replaceAndMark(sanitized, /\b(?:rua|avenida|av\.|rodovia|travessa)\s+[A-ZÀ-Ýa-zà-ÿ0-9 .-]{5,}/gi, '[endereco]', detected, 'address');
  sanitized = replaceAndMark(sanitized, /\b(?:srv|server|host|vm|db)-[a-z0-9-]{3,}\b/gi, '[servidor_interno]', detected, 'server_name');
  sanitized = replaceAndMark(sanitized, /\b(?:[A-Za-z0-9+/]{80,}={0,2})\b/g, '[base64]', detected, 'base64');
  sanitized = sanitized.replace(/<script[\s\S]*?<\/script>/gi, '[script_removed]');
  sanitized = sanitized.replace(/<iframe[\s\S]*?<\/iframe>/gi, '[iframe_removed]');
  sanitized = sanitized.replace(/data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi, '[image_base64]');
  sanitized = sanitized.replace(/<[^>]+>/g, ' ');
  sanitized = sanitized.replace(/\s+/g, ' ').trim().slice(0, MAX_PROMPT_CHARS);

  const residual = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(password|senha|token|api[_-]?key|app[_-]?secret)\s*[:=]\s*[^,\s]+/i.test(sanitized);
  const blocked = detected.size > 0 || residual;

  return {
    inputHash: hash(original),
    anonymizedPayloadHash: hash(sanitized),
    sanitizedText: sanitized,
    detectedKinds: [...detected].sort(),
    blocked,
    blockedReason: blocked ? 'EXTERNAL_RESEARCH_PAYLOAD_BLOCKED_PII_OR_SECRET' : null,
  };
}
