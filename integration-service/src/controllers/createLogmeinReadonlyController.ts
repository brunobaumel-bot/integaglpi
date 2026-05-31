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
