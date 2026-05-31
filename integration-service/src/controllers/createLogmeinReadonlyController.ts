import type { Request, Response } from 'express';

import type { LogmeinReadonlyContextService } from '../domain/services/LogmeinReadonlyContextService.js';
import { logger } from '../infra/logger/logger.js';

export function createLogmeinReadonlySyncController(service: LogmeinReadonlyContextService) {
  return async (_request: Request, response: Response): Promise<Response> => {
    try {
      const result = await service.syncHostsWithGroups();
      const statusCode = result.ok
        ? 200
        : result.status === 'migration_required' || result.status === 'unconfigured' || result.status === 'sync_in_progress'
          ? 409
          : 503;

      return response.status(statusCode).json({
        ok: result.ok,
        status: result.status,
        message: result.message,
        groups_imported: result.groupsImported,
        hosts_imported: result.hostsImported,
        duration_ms: result.durationMs,
        endpoint: result.endpoint,
        read_only: true,
        remote_execution: false,
      });
    } catch (error: unknown) {
      logger.error(
        {
          error_message: error instanceof Error ? error.message : String(error),
          read_only: true,
          remote_execution: false,
        },
        '[integration-service][logmein][SYNC_UNEXPECTED_ERROR]',
      );

      return response.status(500).json({
        ok: false,
        status: 'failed',
        message: 'Contexto de ativo temporariamente indisponível.',
        read_only: true,
        remote_execution: false,
      });
    }
  };
}

/**
 * GET /internal/glpi/logmein/health
 * Returns sync health summary: metrics, alert flags, and cache age.
 * No secrets, no PII, no remote-execution indicators.
 */
export function createLogmeinHealthController(service: LogmeinReadonlyContextService) {
  return async (_request: Request, response: Response): Promise<Response> => {
    try {
      const summary = await service.getHealthSummary();
      // 503 only on critical (consistent with health endpoint convention).
      const httpStatus = summary.status === 'critical' ? 503 : 200;
      return response.status(httpStatus).json(summary);
    } catch (error: unknown) {
      logger.error(
        {
          error_message: error instanceof Error ? error.message : String(error),
          read_only: true,
        },
        '[integration-service][logmein][HEALTH_UNEXPECTED_ERROR]',
      );
      return response.status(500).json({
        ok: false,
        status: 'unavailable',
        read_only: true,
      });
    }
  };
}
