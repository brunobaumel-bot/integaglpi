import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerError = vi.fn();

vi.mock('../src/infra/logger/logger.js', () => ({
  logger: {
    error: loggerError,
  },
}));

const { ResilientHttpClient } = await import('../src/infra/http/ResilientHttpClient.js');

// A real-world signed Meta media URL that must never leak sensitive params
// (access_token, expires, signature) or the URL fragment into any log entry.
const SIGNED_META_URL =
  'https://lookaside.fbsbx.com/whatsapp_business/attachments/file.jpg?access_token=FAKE_SECRET&expires=999&signature=FAKE_SIG#frag';

// Expected sanitized form: origin + pathname only (Meta CDN host → full strip).
const SANITIZED_META_URL =
  'https://lookaside.fbsbx.com/whatsapp_business/attachments/file.jpg';

describe('ResilientHttpClient', () => {
  beforeEach(() => {
    loggerError.mockReset();
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Network / generic error  (existing coverage)
  // ---------------------------------------------------------------------------

  it('logs a sanitized URL when fetch fails for a signed Meta media URL', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));

    const client = new ResilientHttpClient();

    await expect(client.request(SIGNED_META_URL, { timeoutMs: 1_000, retries: 0 })).rejects.toThrow(
      'network down',
    );

    expect(loggerError).toHaveBeenCalledTimes(1);
    const [loggedFields] = loggerError.mock.calls[0];

    expect(loggedFields.url).toBe(SANITIZED_META_URL);
    expect(JSON.stringify(loggedFields)).not.toContain('FAKE_SECRET');
    expect(JSON.stringify(loggedFields)).not.toContain('access_token');
    expect(JSON.stringify(loggedFields)).not.toContain('expires=999');
    expect(JSON.stringify(loggedFields)).not.toContain('signature=FAKE_SIG');
    expect(JSON.stringify(loggedFields)).not.toContain('?');
    expect(JSON.stringify(loggedFields)).not.toContain('#frag');
  });

  // ---------------------------------------------------------------------------
  // AbortError  — e.g. an upstream caller calls abort() on its own signal.
  // ---------------------------------------------------------------------------

  it('logs sanitized URL and preserves AbortError name when fetch rejects with AbortError', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(abortError);

    const client = new ResilientHttpClient();

    await expect(client.request(SIGNED_META_URL, { timeoutMs: 5_000, retries: 0 })).rejects.toThrow(
      'The operation was aborted.',
    );

    expect(loggerError).toHaveBeenCalledTimes(1);
    const [loggedFields] = loggerError.mock.calls[0];

    // URL must be sanitized — no secrets, no query params, no fragment.
    expect(loggedFields.url).toBe(SANITIZED_META_URL);
    expect(JSON.stringify(loggedFields)).not.toContain('FAKE_SECRET');
    expect(JSON.stringify(loggedFields)).not.toContain('access_token');
    expect(JSON.stringify(loggedFields)).not.toContain('expires=999');
    expect(JSON.stringify(loggedFields)).not.toContain('signature=FAKE_SIG');
    expect(JSON.stringify(loggedFields)).not.toContain('?');
    expect(JSON.stringify(loggedFields)).not.toContain('#frag');

    // Error metadata must reflect the AbortError nature.
    expect(loggedFields.errorName).toBe('AbortError');
    expect(loggedFields.errorMessage).toContain('aborted');
  });

  // ---------------------------------------------------------------------------
  // Timeout-driven abort  — the internal setTimeout triggers abortController.abort(),
  // which causes fetch to reject with an AbortError.
  //
  // We use a real 1 ms timeout rather than fake timers to avoid Node.js's
  // "PromiseRejectionHandledWarning" that arises when a Promise is rejected
  // synchronously inside a fake-timer callback before microtasks flush.
  // A 1 ms threshold is short enough to fire reliably in any environment.
  // ---------------------------------------------------------------------------

  it('aborts the request after timeoutMs and logs a sanitized URL (no secrets in log)', async () => {
    // Mock fetch: stays pending until the AbortSignal fires (mimics a stalled
    // connection), then rejects with AbortError exactly as native fetch does.
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      const signal = init?.signal as AbortSignal | undefined;
      return new Promise<Response>((_resolve, reject) => {
        const onAbort = (): void => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        };
        if (signal?.aborted) {
          onAbort();
        } else {
          signal?.addEventListener('abort', onAbort, { once: true });
        }
      });
    });

    const client = new ResilientHttpClient();

    // timeoutMs: 1 — the real 1 ms timer fires almost immediately, aborts
    // the AbortController, which triggers our mock's abort listener.
    await expect(client.request(SIGNED_META_URL, { timeoutMs: 1, retries: 0 })).rejects.toThrow(
      'The operation was aborted.',
    );

    // Exactly one error log, with sanitized URL and no secrets.
    expect(loggerError).toHaveBeenCalledTimes(1);
    const [loggedFields] = loggerError.mock.calls[0];

    expect(loggedFields.url).toBe(SANITIZED_META_URL);
    expect(JSON.stringify(loggedFields)).not.toContain('FAKE_SECRET');
    expect(JSON.stringify(loggedFields)).not.toContain('access_token');
    expect(JSON.stringify(loggedFields)).not.toContain('expires=999');
    expect(JSON.stringify(loggedFields)).not.toContain('signature=FAKE_SIG');
    expect(JSON.stringify(loggedFields)).not.toContain('?');
    expect(JSON.stringify(loggedFields)).not.toContain('#frag');

    expect(loggedFields.errorName).toBe('AbortError');
  });

  // ---------------------------------------------------------------------------
  // HTTP error — non-ok response with status < 500 is returned as-is; the
  // client must NOT log it (logging is reserved for network / throw paths).
  // ---------------------------------------------------------------------------

  it('returns a 4xx response without logging when status is below 500', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 400 }));

    const client = new ResilientHttpClient();
    const response = await client.request(SIGNED_META_URL, { timeoutMs: 5_000, retries: 0 });

    expect(response.status).toBe(400);
    expect(response.ok).toBe(false);
    // No error logging — this is a normal (if unsuccessful) HTTP exchange.
    expect(loggerError).not.toHaveBeenCalled();
  });

  it('returns a 5xx response without retrying when retries are exhausted', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 503 }));

    const client = new ResilientHttpClient();
    // retries: 0 → only one attempt; the 503 is returned directly (no retry possible).
    const response = await client.request(SIGNED_META_URL, { timeoutMs: 5_000, retries: 0 });

    expect(response.status).toBe(503);
    // Response.ok is false for 5xx, but no exception was thrown — no error log expected.
    expect(loggerError).not.toHaveBeenCalled();
  });

  it('retries on 5xx and logs sanitized URL only after all retries are exhausted via throw', async () => {
    // Two 500 responses, then a network throw — ensures the logger fires exactly once
    // at the throw path, not on the retried 5xx responses.
    const networkError = new Error('connection reset');
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockRejectedValueOnce(networkError);

    const client = new ResilientHttpClient();
    await expect(client.request(SIGNED_META_URL, { timeoutMs: 5_000, retries: 1 })).rejects.toThrow(
      'connection reset',
    );

    // Only the final failure (the throw path) must be logged.
    expect(loggerError).toHaveBeenCalledTimes(1);
    const [loggedFields] = loggerError.mock.calls[0];

    expect(loggedFields.url).toBe(SANITIZED_META_URL);
    expect(JSON.stringify(loggedFields)).not.toContain('FAKE_SECRET');
    expect(JSON.stringify(loggedFields)).not.toContain('access_token');
    expect(JSON.stringify(loggedFields)).not.toContain('?');
    expect(JSON.stringify(loggedFields)).not.toContain('#frag');
  });
});
