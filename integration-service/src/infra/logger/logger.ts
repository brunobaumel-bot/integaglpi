import pino from 'pino';

const SECRET_KEY_PATTERN =
  /(?:authorization|bearer|app[-_]?token|user[-_]?token|session[-_]?token|x[-_]?api[-_]?key|api[-_]?key|psk|secret|password|access[-_]?token|refresh[-_]?token|client[-_]?secret|verify[-_]?token)/i;
const PHONE_KEY_PATTERN = /(?:phone|telefone|wa_id|phone_number_id|display_phone_number)/i;
const NAME_KEY_PATTERN = /^(?:name|contact_name|customer_name|client_name|requester_name|profile_name|display_name)$/i;
const TEXT_PII_KEY_PATTERN = /(?:content|message|text|body|payload|description|comment|followup|solution)/i;
const OPERATIONAL_ID_KEY_PATTERN = /(?:^id$|_id$|Id$|correlation_id|request_id|message_id|ticket_id|conversation_id|event_type|error_type|error_code|status|path|pathname|url|stage)/;
const PHONE_TEXT_PATTERN = /(?<![A-Za-z0-9])(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?(?:9\s*)?\d{4,5}[-.\s]?\d{4}(?![A-Za-z0-9])/g;
const SECRET_TEXT_PATTERN =
  /\b(?:authorization|bearer|app[-_]?token|user[-_]?token|session[-_]?token|x[-_]?api[-_]?key|api[-_]?key|psk|secret|password|access[-_]?token|refresh[-_]?token|client[-_]?secret|verify[-_]?token)\b\s*[:=]?\s*(?:bearer\s+)?["']?[^"',\s}]+["']?/gi;
const NAME_TEXT_PATTERN = /\b(?:nome|cliente|contato)\s*[:=]\s*[^,\n\r|]+/gi;
const MAX_LOG_TEXT_LENGTH = 2000;

function sanitizeTextForLog(value: string): string {
  const compact = value.length > MAX_LOG_TEXT_LENGTH
    ? `${value.slice(0, MAX_LOG_TEXT_LENGTH)}...[TRUNCATED]`
    : value;

  return compact
    .replace(SECRET_TEXT_PATTERN, '[REDACTED]')
    .replace(NAME_TEXT_PATTERN, '[NAME_REDACTED]')
    .replace(PHONE_TEXT_PATTERN, '[PHONE_REDACTED]');
}

function sanitizeLogValue(value: unknown, key = '', seen = new WeakSet<object>()): unknown {
  if (SECRET_KEY_PATTERN.test(key)) {
    return '[REDACTED]';
  }

  if (PHONE_KEY_PATTERN.test(key)) {
    return '[PHONE_REDACTED]';
  }

  if (NAME_KEY_PATTERN.test(key)) {
    return '[NAME_REDACTED]';
  }

  if (OPERATIONAL_ID_KEY_PATTERN.test(key)) {
    return value;
  }

  if (typeof value === 'string') {
    if (TEXT_PII_KEY_PATTERN.test(key)) {
      return sanitizeTextForLog(value);
    }

    return sanitizeTextForLog(value);
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return '[CIRCULAR]';
    }
    seen.add(value);
    return value.map((item) => sanitizeLogValue(item, key, seen));
  }

  if (value && typeof value === 'object') {
    if (seen.has(value)) {
      return '[CIRCULAR]';
    }
    seen.add(value);

    const sanitized: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(value as Record<string, unknown>)) {
      sanitized[entryKey] = sanitizeLogValue(entryValue, entryKey, seen);
    }

    return sanitized;
  }

  return value;
}

export function sanitizeLogObjectForTelemetry(value: Record<string, unknown>): Record<string, unknown> {
  return sanitizeLogValue(value) as Record<string, unknown>;
}

export const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  formatters: {
    log(object) {
      return sanitizeLogObjectForTelemetry(object);
    },
  },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers["x-integaglpi-api-key"]',
      'req.headers["x-hub-signature-256"]',
      'req.headers["x-api-key"]',
      'req.headers["app-token"]',
      'req.headers["user-token"]',
      'req.headers["user_token"]',
      'req.headers["session-token"]',
      'req.headers["session_token"]',
      'headers.authorization',
      'headers["app-token"]',
      'headers["user-token"]',
      'headers["user_token"]',
      'headers["session-token"]',
      'headers["session_token"]',
      'headers["x-api-key"]',
      'headers["x-integaglpi-api-key"]',
      'metaAppSecret',
      'clientSecret',
      'refreshToken',
      'accessToken',
      'appToken',
      'userToken',
      'sessionToken',
    ],
    censor: '[REDACTED]',
  },
});
