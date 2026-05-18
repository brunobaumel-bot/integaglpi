const META_MEDIA_HOST_PATTERN = /(^|\.)((fbsbx|fbcdn)\.com|facebook\.com|whatsapp\.net)$/i;
const SENSITIVE_QUERY_KEY_PATTERN =
  /^(access_token|token|signature|sig|expires|ext|hash|access_key|key|auth|authorization|secret|password|session|session_token|api_key|apikey|x-api-key|x_api_key|xapikey|api-key)$/i;

/** Remove valores sensíveis de URLs antes de registrar logs. */
export function sanitizeUrlForLog(fullUrl: string): string {
  try {
    const url = new URL(fullUrl);

    if (META_MEDIA_HOST_PATTERN.test(url.hostname)) {
      return `${url.origin}${url.pathname}`;
    }

    url.hash = '';

    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_QUERY_KEY_PATTERN.test(key)) {
        url.searchParams.set(key, '[REDACTED]');
      }
    }

    return url.toString();
  } catch {
    return '[INVALID_URL]';
  }
}
