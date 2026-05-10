/** Remove valores sensíveis de query string para log (tokens em URL são redatados). */
export function sanitizeUrlForLog(fullUrl: string): string {
  try {
    const u = new URL(fullUrl);
    const sensitiveKey = (key: string) =>
      /token|secret|password|session|authorization/i.test(key);

    for (const key of [...u.searchParams.keys()]) {
      if (sensitiveKey(key)) {
        u.searchParams.set(key, '[REDACTED]');
      }
    }

    return u.toString();
  } catch {
    return '[invalid_url]';
  }
}
