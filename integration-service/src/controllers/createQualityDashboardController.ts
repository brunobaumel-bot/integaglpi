import type { Request, Response } from 'express';

import { QualityDashboardError, type QualityDashboardService } from '../services/QualityDashboardService.js';
import { logger } from '../infra/logger/logger.js';

function parseInteger(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number.parseInt(value.trim(), 10);
    return parsed > 0 ? parsed : undefined;
  }

  return undefined;
}

function parseEntityIds(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value.flatMap(parseEntityIds);
  }
  if (typeof value !== 'string') {
    return [];
  }

  return value
    .split(',')
    .map((item) => Number.parseInt(item.trim(), 10))
    .filter((id) => Number.isInteger(id) && id > 0);
}

function parseText(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed !== '' ? trimmed : undefined;
}

export function createQualityDashboardController(qualityDashboardService: QualityDashboardService) {
  return async (request: Request, response: Response): Promise<Response> => {
    try {
      const result = await qualityDashboardService.getDashboard({
        dateFrom: String(request.query.date_from ?? ''),
        dateTo: String(request.query.date_to ?? ''),
        entityIds: parseEntityIds(request.query.entity_ids),
        queueId: parseInteger(request.query.queue_id),
        technicianId: parseInteger(request.query.technician_id),
        status: parseText(request.query.status),
        csat: parseText(request.query.csat),
        sla: parseText(request.query.sla),
        deliveryStatus: parseText(request.query.delivery_status),
        inactivity: parseText(request.query.inactivity),
        page: parseInteger(request.query.page) ?? 1,
        limit: parseInteger(request.query.limit) ?? 25,
      });

      return response.status(200).json(result);
    } catch (error) {
      if (error instanceof QualityDashboardError) {
        return response.status(error.statusCode).json({
          ok: false,
          error_code: error.errorCode,
          message: error.message,
        });
      }

      logger.error(
        {
          error_message: error instanceof Error ? error.message : String(error),
        },
        '[integration-service][quality_dashboard][UNEXPECTED_ERROR]',
      );

      return response.status(500).json({
        ok: false,
        error_code: 'QUALITY_DASHBOARD_FAILED',
        message: 'Não foi possível carregar o dashboard de qualidade agora.',
      });
    }
  };
}
