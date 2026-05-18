const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_PATTERN = /(?:\+?\d[\s().-]*){10,16}/g;
const LONG_NUMBER_PATTERN = /\b\d{6,}\b/g;
const BASE64_LIKE_PATTERN = /\b[A-Za-z0-9+/]{80,}={0,2}\b/g;

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
    .replace(BASE64_LIKE_PATTERN, '[DADO_REMOVIDO]')
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
