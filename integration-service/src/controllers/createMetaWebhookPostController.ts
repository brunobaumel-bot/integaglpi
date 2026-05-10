import type { Request, Response } from 'express';

import { metaWebhookPayloadSchema } from '../adapters/meta/metaWebhookTypes.js';
import type { AuditService } from '../domain/services/AuditService.js';
import type { InboundWebhookService } from '../domain/services/InboundWebhookService.js';
import { getOrCreateCorrelationId } from '../domain/services/correlationId.js';
import { logger } from '../infra/logger/logger.js';

export function createMetaWebhookPostController(
  inboundWebhookService: InboundWebhookService,
  auditService?: AuditService,
) {
  return async function metaWebhookPostController(req: Request, res: Response): Promise<void> {
    const correlationId = getOrCreateCorrelationId(req.header('x-correlation-id'));
    const parsedPayload = metaWebhookPayloadSchema.safeParse(req.body);

    if (!parsedPayload.success) {
      res.status(400).json({
        error: 'invalid_meta_payload',
      });
      return;
    }

    try {
      auditService?.recordAuditEventFireAndForget({
        correlationId,
        eventType: 'WEBHOOK_RECEIVED',
        status: 'success',
        severity: 'info',
        source: 'MetaWebhookPostController',
        payload: { object: parsedPayload.data.object, entry_count: parsedPayload.data.entry.length },
      });
      logger.info(
        { correlation_id: correlationId, event_type: 'WEBHOOK_RECEIVED', status: 'success', source: 'MetaWebhookPostController' },
        '[integration-service][webhook][RECEIVED]',
      );

      const result = await inboundWebhookService.process(parsedPayload.data, { correlationId });

      res.status(200).json({
        status: 'accepted',
        results: result.results,
      });
    } catch (error: unknown) {
      logger.error(
        { correlation_id: correlationId, event_type: 'WEBHOOK_PROCESSING_FAILED', status: 'failed', source: 'MetaWebhookPostController', error },
        'Failed to persist or process inbound Meta webhook.',
      );

      res.status(500).json({
        error: 'webhook_processing_failed',
      });
    }
  };
}
