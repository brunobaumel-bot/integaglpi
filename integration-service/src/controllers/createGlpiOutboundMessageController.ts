import type { RequestHandler } from 'express';
import { z } from 'zod';

import type { OutboundMessageService } from '../domain/services/OutboundMessageService.js';
import { getOrCreateCorrelationId } from '../domain/services/correlationId.js';

const outboundBaseSchema = z.object({
  ticket_id: z.number().int().positive(),
  conversation_id: z.string().min(1).max(128),
  text: z.string().min(1).max(4096),
  glpi_user_id: z.number().int().positive(),
  idempotency_key: z
    .preprocess((value) => (value === '' || value === null || value === undefined ? undefined : value), z.string().min(8).max(256).optional()),
});

const mediaSchema = (maxBase64Length: number) => z.object({
  filename: z.string().min(1).max(180),
  mime_type: z.string().min(3).max(120),
  content_base64: z.string().min(1).max(maxBase64Length),
  document_id: z.number().int().positive().optional(),
});

const outboundBodySchema = z.discriminatedUnion('message_type', [
  outboundBaseSchema.extend({
    message_type: z.literal('text'),
  }),
  outboundBaseSchema.extend({
    message_type: z.literal('document'),
    media: mediaSchema(25_000_000),
  }),
  outboundBaseSchema.extend({
    message_type: z.literal('image'),
    media: mediaSchema(25_000_000),
  }),
  outboundBaseSchema.extend({
    message_type: z.literal('audio'),
    media: mediaSchema(25_000_000),
  }),
  outboundBaseSchema.extend({
    message_type: z.literal('video'),
    media: mediaSchema(90_000_000),
  }),
]);

export function createGlpiOutboundMessageController(outboundMessageService: OutboundMessageService): RequestHandler {
  return async (req, res) => {
    const parsed = outboundBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        status: 'failed',
        error_code: 'VALIDATION_ERROR',
        message: 'Invalid outbound payload.',
        details: parsed.error.flatten(),
      });
      return;
    }

    const correlationId = getOrCreateCorrelationId(req.header('x-correlation-id'));
    const result = await outboundMessageService.send(parsed.data, { correlationId });
    res.status(result.httpStatus).json(result.body);
  };
}
