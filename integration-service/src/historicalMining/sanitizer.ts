import { createHash } from 'node:crypto';

const MAX_TEXT_LENGTH = 2_000;

const SECRET_PATTERNS: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\b(?:password|passwd|senha|token|api[_-]?key|app[_-]?secret|secret)\s*[:=]\s*['"]?[^'"\s;]+/gi,
  /-----BEGIN\s+(?:RSA\s+|EC\s+|OPENSSH\s+)?PRIVATE KEY-----[\s\S]*?-----END\s+(?:RSA\s+|EC\s+|OPENSSH\s+)?PRIVATE KEY-----/gi,
  /https?:\/\/\S*(?:access_token|token|bearer|signature|app_secret|api_key)\S*/gi,
];

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hashTicketIdentifier(value: unknown): string {
  const text = String(value ?? '').trim();
  if (/^[a-f0-9]{64}$/i.test(text)) {
    return text.toLowerCase();
  }

  return sha256Hex(text || 'missing-ticket-id');
}

export function sanitizeHistoricalText(value: unknown, maxLength = MAX_TEXT_LENGTH): string {
  let text = String(value ?? '');
  if (text === '') {
    return '';
  }

  text = text.replace(/\r?\n/g, ' ');
  text = text.replace(/[A-Za-z0-9+/]{80,}={0,2}/g, '[BASE64_REMOVIDO]');
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, '[SEGREDO_REMOVIDO]');
  }
  text = text.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[EMAIL]');
  text = text.replace(/\b(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?(?:9\s*)?\d{4}[-\s]?\d{4}\b/g, '[TELEFONE]');
  text = text.replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[DOCUMENTO]');
  text = text.replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, '[DOCUMENTO]');
  text = text.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[IP]');
  text = text.replace(/\b(?:[a-z0-9-]+\.)+(?:local|corp|intra|internal|lan)\b/gi, '[DOMINIO_INTERNO]');
  text = text.replace(/\bcontrato\s*[:#=]?\s*[A-Za-z0-9._/-]+/gi, 'contrato [CONTRATO]');
  text = text.replace(/\b[A-ZÁÉÍÓÚÀÂÊÔÃÕÇ][a-záéíóúàâêôãõç]+(?:\s+[A-ZÁÉÍÓÚÀÂÊÔÃÕÇ][a-záéíóúàâêôãõç]+){1,2}\b/g, '[NOME]');
  text = text.replace(/\s{2,}/g, ' ').trim();

  if (text.length > maxLength) {
    return `${text.slice(0, Math.max(0, maxLength - 15)).trim()} [TRUNCADO]`;
  }

  return text;
}

export function hasObviousSensitiveContent(value: string): boolean {
  return /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(value)
    || /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/.test(value)
    || /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/.test(value)
    || /\bBearer\s+[A-Za-z0-9._~+/=-]+/i.test(value)
    || /\b(?:password|passwd|senha|token|api[_-]?key|app[_-]?secret|secret)\s*[:=]/i.test(value)
    || /[A-Za-z0-9+/]{80,}={0,2}/.test(value);
}
