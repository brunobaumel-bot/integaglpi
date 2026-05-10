import type { GlpiFailureStage } from '../../errors/GlpiRequestError.js';
import { GlpiRequestError } from '../../errors/GlpiRequestError.js';

/**
 * Expõe causa da falha para o Pino (evita `error: {}` com instâncias `Error`).
 * `glpiRequestUrl` já vem sanitizada em `GlpiClient` (sem tokens sensíveis na query).
 */
export function serializeInboundFailure(
  error: unknown,
  contextualStage: GlpiFailureStage | 'unknown' | undefined,
): Record<string, unknown> {
  const stage: GlpiFailureStage | 'unknown' =
    error instanceof GlpiRequestError && error.stage !== undefined
      ? error.stage
      : contextualStage ?? 'unknown';

  const errorDetail: Record<string, unknown> = {};

  if (error instanceof Error) {
    errorDetail.message = error.message;
    errorDetail.name = error.name;
    errorDetail.stack = error.stack;

    const code = (error as NodeJS.ErrnoException).code;
    if (code !== undefined) {
      errorDetail.code = code;
    }
  }

  if (error instanceof GlpiRequestError) {
    errorDetail.response = {
      status: error.statusCode,
      data: error.responseBody,
    };
  } else {
    const maybeAxios = error as { response?: { status?: number; data?: unknown } };
    if (maybeAxios.response !== undefined) {
      errorDetail.response = {
        status: maybeAxios.response.status,
        data: maybeAxios.response.data,
      };
    }
  }

  const result: Record<string, unknown> = { stage };

  if (Object.keys(errorDetail).length > 0) {
    result.error = errorDetail;
  }

  if (error instanceof GlpiRequestError && error.requestUrl !== undefined) {
    result.glpiRequestUrl = error.requestUrl;
  }

  if (!(error instanceof Error)) {
    result.nonErrorPayload = error;
  }

  return result;
}
