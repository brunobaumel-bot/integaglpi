const REDACTED = '[REDACTED]';
const TRUNCATED_PAYLOAD = '[TRUNCATED_PAYLOAD]';
const DEFAULT_MAX_SERIALIZED_BYTES = 16_384;
const MAX_STRING_LENGTH = 2_048;

const SENSITIVE_KEYS = new Set([
  'token',
  'access_token',
  'authorization',
  'app_secret',
  'client_secret',
  'password',
  'psk',
  'api_key',
  'apikey',
  'secret',
  'bearer',
  'document_base64',
  'base64',
  'file_content',
  'media_content',
  'binary',
  'buffer',
  'raw_file',
]);

function normalizeKey(key: string): string {
  return key.trim().toLowerCase();
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(normalizeKey(key));
}

function isBinaryLike(value: unknown): boolean {
  return value instanceof Uint8Array
    || value instanceof ArrayBuffer
    || (typeof Buffer !== 'undefined' && Buffer.isBuffer(value));
}

function sanitizeValue(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}...` : value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (isBinaryLike(value)) {
    return REDACTED;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, seen));
  }

  if (typeof value === 'object') {
    if (seen.has(value)) {
      return '[CIRCULAR]';
    }
    seen.add(value);

    const sanitized: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      sanitized[key] = isSensitiveKey(key) ? REDACTED : sanitizeValue(item, seen);
    }
    return sanitized;
  }

  return String(value);
}

export function sanitizeAuditPayload(payload: unknown, maxSerializedBytes = DEFAULT_MAX_SERIALIZED_BYTES): unknown {
  const sanitized = sanitizeValue(payload, new WeakSet<object>());
  const serialized = JSON.stringify(sanitized);

  if (serialized !== undefined && Buffer.byteLength(serialized, 'utf8') > maxSerializedBytes) {
    return TRUNCATED_PAYLOAD;
  }

  return sanitized;
}

export const AUDIT_PAYLOAD_REDACTED = REDACTED;
export const AUDIT_PAYLOAD_TRUNCATED = TRUNCATED_PAYLOAD;
