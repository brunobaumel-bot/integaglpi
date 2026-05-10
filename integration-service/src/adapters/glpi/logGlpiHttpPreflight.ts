import { logger } from '../../infra/logger/logger.js';
import { sanitizeUrlForLog } from '../../infra/logger/sanitizeUrlForLog.js';

export function maskSecret(value: string): string {
  if (!value || value.length < 8) {
    return '[REDACTED]';
  }

  return `${value.slice(0, 6)}…(len=${value.length})`;
}

/** Log estruturado antes do fetch (PoC): URL final, método, query e headers mascarados. */
export function logGlpiHttpPreflight(
  fullUrl: string,
  method: string,
  headers: HeadersInit | undefined,
  context: { stage?: string },
): void {
  let pathname = '';
  let queryString = '';

  try {
    const u = new URL(fullUrl);
    pathname = u.pathname;
    queryString = u.search.startsWith('?') ? u.search.slice(1) : u.search;
  } catch {
    pathname = '[invalid_url]';
  }

  const masked: Record<string, string> = {};
  const h = new Headers(headers ?? undefined);

  for (const [key, val] of h.entries()) {
    const lower = key.toLowerCase();

    if (lower === 'authorization') {
      masked[key] = val.startsWith('user_token ')
        ? `user_token ${maskSecret(val.slice('user_token '.length).trim())}`
        : '[REDACTED]';
    } else if (lower === 'app-token' || lower === 'session-token') {
      masked[key] = maskSecret(val);
    } else {
      masked[key] = val;
    }
  }

  logger.info(
    {
      stage: context.stage,
      httpMethod: method,
      url: sanitizeUrlForLog(fullUrl),
      pathname,
      queryString,
      headers: masked,
    },
    '[GLPI PoC] outbound HTTP request',
  );
}
