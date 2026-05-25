import type { Request, Response } from 'express';

import { AiOperationsError, type AiOperationsService } from '../domain/services/AiOperationsService.js';
import { logger } from '../infra/logger/logger.js';

function bodyRecord(request: Request): Record<string, unknown> {
  return (request.body && typeof request.body === 'object' && !Array.isArray(request.body))
    ? request.body as Record<string, unknown>
    : {};
}

function parseInteger(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    return Number.parseInt(value.trim(), 10);
  }

  return fallback;
}

function parseBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  return typeof value === 'string' && ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function parseContent(body: Record<string, unknown>): string {
  if (typeof body.jsonl_content === 'string') {
    return body.jsonl_content;
  }
  if (typeof body.jsonl_base64 === 'string') {
    return Buffer.from(body.jsonl_base64, 'base64').toString('utf8');
  }

  return '';
}

function handleAiOperationsError(error: unknown, response: Response, context: string): Response {
  if (error instanceof AiOperationsError) {
    return response.status(error.statusCode).json({
      ok: false,
      error_code: error.errorCode,
      message: error.message,
    });
  }

  logger.error(
    {
      context,
      error_message: error instanceof Error ? error.message : String(error),
    },
    '[integration-service][ai_operations][UNEXPECTED_ERROR]',
  );

  return response.status(500).json({
    ok: false,
    error_code: 'AI_OPERATIONS_FAILED',
    message: 'Não foi possível executar a operação de IA agora.',
  });
}

export function createHistoricalMiningPreviewController(service: AiOperationsService) {
  return async (request: Request, response: Response): Promise<Response> => {
    try {
      const body = bodyRecord(request);
      const result = await service.previewHistoricalMining({
        filename: typeof body.filename === 'string' ? body.filename : 'history.jsonl',
        jsonlContent: parseContent(body),
        maxRows: parseInteger(body.max_rows, 1000),
        windowStart: typeof body.window_start === 'string' ? body.window_start : undefined,
        windowEnd: typeof body.window_end === 'string' ? body.window_end : undefined,
        requestedBy: parseInteger(body.requested_by, 0) || null,
      });

      return response.status(201).json({ ok: true, ...result });
    } catch (error: unknown) {
      return handleAiOperationsError(error, response, 'historical_mining_preview');
    }
  };
}

export function createHistoricalMiningExecuteController(service: AiOperationsService) {
  return async (request: Request, response: Response): Promise<Response> => {
    try {
      const body = bodyRecord(request);
      const result = await service.executeHistoricalMining({
        filename: typeof body.filename === 'string' ? body.filename : 'history.jsonl',
        jsonlContent: parseContent(body),
        maxRows: parseInteger(body.max_rows, 1000),
        windowStart: typeof body.window_start === 'string' ? body.window_start : undefined,
        windowEnd: typeof body.window_end === 'string' ? body.window_end : undefined,
        dryRunToken: typeof body.dry_run_token === 'string' ? body.dry_run_token : undefined,
        requestedBy: parseInteger(body.requested_by, 0) || null,
      });

      return response.status(200).json({ ok: true, ...result });
    } catch (error: unknown) {
      return handleAiOperationsError(error, response, 'historical_mining_execute');
    }
  };
}

export function createKbCandidateGenerateController(service: AiOperationsService) {
  return async (request: Request, response: Response): Promise<Response> => {
    try {
      const body = bodyRecord(request);
      const result = await service.generateKbCandidates({
        runId: typeof body.run_id === 'string' ? body.run_id : '',
        maxCandidates: parseInteger(body.max_candidates, 20),
        minConfidence: parseInteger(body.min_confidence, 65),
        dryRun: parseBoolean(body.dry_run),
        requestedBy: parseInteger(body.requested_by, 0) || null,
      });

      return response.status(200).json({ ok: true, ...result });
    } catch (error: unknown) {
      return handleAiOperationsError(error, response, 'kb_candidate_generate');
    }
  };
}
