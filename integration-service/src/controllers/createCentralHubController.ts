/**
 * createCentralHubController — F3 Central Hub Operacional
 *
 * Factory that returns a GET /internal/glpi/central-hub handler.
 *
 * Safety invariants:
 *   - Read-only: the service never mutates any store.
 *   - Bearer-gated: called only from the PHP plugin with the integration API key.
 *   - No PII in response: only aggregate metrics, no phone / token / credential.
 *   - Errors are isolated per card; a card failure never propagates to HTTP 5xx.
 *
 * Phase: integaglpi_v9_central_hub_001 — F3_2
 */

import type { Request, Response } from 'express';
import { logger } from '../infra/logger/logger.js';
import type { CentralHubAggregatorService } from '../domain/services/CentralHubAggregatorService.js';

export function createCentralHubController(
  service: CentralHubAggregatorService,
): (req: Request, res: Response) => Promise<void> {
  return async (_req: Request, res: Response): Promise<void> => {
    try {
      const snapshot = await service.buildSnapshot();
      res.status(200).json(snapshot);
    } catch (err) {
      logger.error(
        { error_message: err instanceof Error ? err.message : String(err) },
        '[central_hub] aggregator error',
      );
      res.status(500).json({
        ok: false,
        status: 'aggregator_error',
        message: 'Central Hub indisponível. Verifique os logs do integration-service.',
      });
    }
  };
}
