import type { RequestHandler } from 'express';
import { z } from 'zod';

import type { OutboundMessageService } from '../domain/services/OutboundMessageService.js';
import { getOrCreateCorrelationId } from '../domain/services/correlationId.js';

const ticketSolvedNotificationSchema = z.object({
  ticket_id: z.number().int().positive(),
  conversation_id: z.string().min(1).max(128),
  glpi_user_id: z.number().int().positive(),
  idempotency_key: z
    .preprocess(
      (value) => (value === '' || value === null || value === undefined ? undefined : value),
      z.string().min(8).max(256).optional(),
    ),
  solution_id: z.number().int().positive().optional(),
  solution_content: z
    .preprocess(
      (value) => (value === '' || value === null || value === undefined ? undefined : value),
      z.string().max(12000).optional(),
    ),
  solution_status: z.number().int().optional(),
});

export function createGlpiTicketSolvedNotificationController(
  outboundMessageService: OutboundMessageService,
): RequestHandler {
  return async (req, res) => {
    const parsed = ticketSolvedNotificationSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        status: 'failed',
        error_code: 'VALIDATION_ERROR',
        message: 'Invalid ticket solved notification payload.',
        details: parsed.error.flatten(),
      });
      return;
    }

    const correlationId = getOrCreateCorrelationId(req.header('x-correlation-id'));
    const result = await outboundMessageService.sendSolutionApprovalRequest(parsed.data, { correlationId });
    res.status(result.httpStatus).json(result.body);
  };
}
