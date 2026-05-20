import type { Request, Response } from 'express';

import {
  ContactAgendaImportError,
  type ContactAgendaImportService,
} from '../domain/services/ContactAgendaImportService.js';
import { logger } from '../infra/logger/logger.js';

function parseInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return Number.parseInt(value.trim(), 10);
  }

  return null;
}

function parseCsvContent(body: Record<string, unknown>): string {
  if (typeof body.csv_content === 'string') {
    return body.csv_content;
  }
  if (typeof body.csv_base64 === 'string') {
    return Buffer.from(body.csv_base64, 'base64').toString('utf8');
  }

  return '';
}

function handleError(error: unknown, response: Response, context: string): Response {
  if (error instanceof ContactAgendaImportError) {
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
    '[integration-service][contact_import][UNEXPECTED_ERROR]',
  );

  return response.status(500).json({
    ok: false,
    error_code: 'CONTACT_IMPORT_FAILED',
    message: 'Falha inesperada no importador de agenda.',
  });
}

export function createContactAgendaImportPreviewController(service: ContactAgendaImportService) {
  return async (request: Request, response: Response): Promise<Response> => {
    try {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const filename = typeof body.filename === 'string' ? body.filename : 'agenda.csv';
      const csvContent = parseCsvContent(body);
      if (csvContent.trim() === '') {
        return response.status(400).json({
          ok: false,
          error_code: 'CSV_REQUIRED',
          message: 'Conteúdo CSV obrigatório.',
        });
      }

      const result = await service.preview({
        filename,
        csvContent,
        uploadedBy: parseInteger(body.uploaded_by),
      });

      return response.status(201).json({ ok: true, ...result });
    } catch (error: unknown) {
      return handleError(error, response, 'preview');
    }
  };
}

export function createContactAgendaImportConfirmController(service: ContactAgendaImportService) {
  return async (request: Request, response: Response): Promise<Response> => {
    try {
      const result = await service.confirm({
        batchId: String(request.params.batch_id ?? ''),
        confirmedBy: parseInteger(request.body?.confirmed_by),
      });

      return response.status(200).json({ ok: true, ...result });
    } catch (error: unknown) {
      return handleError(error, response, 'confirm');
    }
  };
}

export function createContactAgendaImportStatusController(service: ContactAgendaImportService) {
  return async (request: Request, response: Response): Promise<Response> => {
    try {
      const result = await service.getStatus(String(request.params.batch_id ?? ''));
      return response.status(200).json({ ok: true, ...result });
    } catch (error: unknown) {
      return handleError(error, response, 'status');
    }
  };
}

export function createContactAgendaImportRollbackController(service: ContactAgendaImportService) {
  return async (request: Request, response: Response): Promise<Response> => {
    try {
      const result = await service.rollback({
        batchId: String(request.params.batch_id ?? ''),
        requestedBy: parseInteger(request.body?.requested_by),
        reason: typeof request.body?.reason === 'string' ? request.body.reason : '',
      });

      return response.status(200).json({ ok: true, ...result });
    } catch (error: unknown) {
      return handleError(error, response, 'rollback');
    }
  };
}
