import { logger } from '../logger/logger.js';
import { sanitizeUrlForLog } from '../logger/sanitizeUrlForLog.js';

export interface HttpRequestOptions extends Omit<RequestInit, 'signal'> {
  timeoutMs: number;
  retries: number;
}

function logFetchFailure(url: string, error: unknown): void {
  const err = error instanceof Error ? error : new Error(String(error));
  const errno = error as NodeJS.ErrnoException;
  const sanitizedUrl = sanitizeUrlForLog(url);

  logger.error(
    {
      url: sanitizedUrl,
      errorMessage: err.message,
      errorName: err.name,
      errorCode: errno.code,
      errorCause: err.cause,
      errorStack: err.stack,
    },
    'HTTP fetch failed (network or abort).',
  );
}

export class ResilientHttpClient {
  public async request(url: string, options: HttpRequestOptions): Promise<Response> {
    const { timeoutMs, retries, ...requestInit } = options;

    let currentAttempt = 0;

    while (currentAttempt <= retries) {
      const abortController = new AbortController();
      const timeoutHandle = setTimeout(() => abortController.abort(), timeoutMs);

      try {
        const response = await fetch(url, {
          ...requestInit,
          signal: abortController.signal,
        });

        clearTimeout(timeoutHandle);

        if (!response.ok && currentAttempt < retries && response.status >= 500) {
          currentAttempt += 1;
          continue;
        }

        return response;
      } catch (error: unknown) {
        clearTimeout(timeoutHandle);

        if (currentAttempt >= retries) {
          logFetchFailure(url, error);
          throw error;
        }

        currentAttempt += 1;
      }
    }

    const finalError = new Error('HTTP request failed after exhausting retries.');
    logFetchFailure(url, finalError);
    throw finalError;
  }
}
