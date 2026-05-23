const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_PATTERN = /(?:\+?\d[\s().-]*){10,16}/g;
const LONG_NUMBER_PATTERN = /\b\d{6,}\b/g;
const BASE64_LIKE_PATTERN = /\b[A-Za-z0-9+/]{80,}={0,2}\b/g;
const META_TEMP_URL_PATTERN = /\bhttps?:\/\/(?:lookaside\.fbsbx\.com|graph\.facebook\.com|[^/\s]*whatsapp[^/\s]*)\/[^\s]*/gi;
const SECRET_KEY_PATTERN = /\b(?:token|secret|bearer|authorization|password|app_secret|access_token|x-hub-signature|x-hub-signature-256)\b\s*[:=]\s*["']?[^"',\s}]+["']?/gi;
const AUTH_HEADER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]{10,}/gi;
const DATA_URL_PATTERN = /\bdata:[^;\s]+;base64,[A-Za-z0-9+/=\s]+/gi;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function maskKnownName(text: string, name: string | null | undefined, replacement: string): string {
  const normalized = typeof name === 'string' ? name.trim() : '';
  if (normalized.length < 2) {
    return text;
  }

  return text.replace(new RegExp(`\\b${escapeRegExp(normalized)}\\b`, 'gi'), replacement);
}

export function sanitizeAiQualityText(text: string, knownNames: Array<string | null | undefined> = []): string {
  let sanitized = text
    .replace(DATA_URL_PATTERN, '[BINARIO_REMOVIDO]')
    .replace(BASE64_LIKE_PATTERN, '[DADO_REMOVIDO]')
    .replace(META_TEMP_URL_PATTERN, '[URL_REMOVIDA]')
    .replace(AUTH_HEADER_PATTERN, 'Bearer [SEGREDO_REMOVIDO]')
    .replace(SECRET_KEY_PATTERN, '[SEGREDO_REMOVIDO]')
    .replace(/\b(?:cpf|cnpj|rg)\s*[:#-]?\s*[\d./-]+/gi, '[DADO_REMOVIDO]')
    .replace(EMAIL_PATTERN, '[EMAIL]')
    .replace(PHONE_PATTERN, '[TELEFONE]')
    .replace(LONG_NUMBER_PATTERN, '[DADO_REMOVIDO]');

  for (const name of knownNames) {
    sanitized = maskKnownName(sanitized, name, '[CLIENTE]');
  }

  sanitized = sanitized
    .replace(/\bcontrato\s+[\w./-]+/gi, 'contrato [CONTRATO]');

  return sanitized.trim();
}
