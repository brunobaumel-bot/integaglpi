import type { Request, Response } from 'express';

import {
  ConversationSoftCloseError,
  type ConversationSoftCloseService,
} from '../domain/services/ConversationSoftCloseService.js';

function normalizeOperatorId(value: unknown): number {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  return 0;
}

function clientIp(request: Request): string | null {
  const forwarded = request.header('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) {
      return first.slice(0, 80);
    }
  }
  return request.ip ? String(request.ip).slice(0, 80) : null;
}

export function createConversationSoftCloseController(service: ConversationSoftCloseService) {
  return async (request: Request, response: Response) => {
    const conversationId = String(request.params.conversation_id ?? '').trim();
    const reason = typeof request.body?.reason === 'string' ? request.body.reason : '';
    const operatorId = normalizeOperatorId(request.body?.glpi_user_id ?? request.body?.operator_id);
    const operatorName = typeof request.body?.operator_name === 'string'
      ? request.body.operator_name.trim().slice(0, 160)
      : null;

    if (request.body?.permission_validated !== true) {
      response.status(403).json({
        ok: false,
        error_code: 'PERMISSION_NOT_VALIDATED',
        message: 'Permissão do operador não foi validada pelo plugin.',
      });
      return;
    }

    try {
      const result = await service.softClose({
        conversationId,
        reason,
        operatorId,
        operatorName,
        ip: clientIp(request),
      });

      response.status(result.idempotent ? 200 : 200).json({
        ok: true,
        status: result.status,
        conversation_id: result.conversationId,
        previous_status: result.previousStatus,
        new_status: result.newStatus,
        idempotent: result.idempotent,
        message: result.message,
      });
    } catch (error) {
      if (error instanceof ConversationSoftCloseError) {
        response.status(error.statusCode).json({
          ok: false,
          error_code: error.errorCode,
          message: error.message,
          details: error.details,
        });
        return;
      }

      response.status(500).json({
        ok: false,
        error_code: 'SOFT_CLOSE_FAILED',
        message: 'Não foi possível encerrar administrativamente a conversa agora.',
      });
    }
  };
}
