import type { Request, Response } from 'express';

import {
  ManualTicketWhatsappLinkError,
  type ManualTicketWhatsappLinkService,
} from '../domain/services/ManualTicketWhatsappLinkService.js';
import { logger } from '../infra/logger/logger.js';

function parsePositiveInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return Number.parseInt(value.trim(), 10);
  }

  return null;
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => String(item ?? '').trim()).filter((item) => item !== '');
}

function handleError(error: unknown, response: Response, context: string): Response {
  if (error instanceof ManualTicketWhatsappLinkError) {
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
    '[integration-service][manual_ticket_whatsapp][UNEXPECTED_ERROR]',
  );

  return response.status(500).json({
    ok: false,
    error_code: 'MANUAL_TICKET_WHATSAPP_FAILED',
    message: 'Falha inesperada ao preparar atendimento WhatsApp do chamado.',
  });
}

export function createManualTicketWhatsappResolveController(service: ManualTicketWhatsappLinkService) {
  return async (request: Request, response: Response): Promise<Response> => {
    try {
      const ticketId = parsePositiveInteger(request.params.ticket_id);
      const body = (request.body ?? {}) as Record<string, unknown>;
      const result = await service.resolve({
        ticketId: ticketId ?? 0,
        requesterName: typeof body.requester_name === 'string' ? body.requester_name : null,
        requesterEmail: typeof body.requester_email === 'string' ? body.requester_email : null,
        requesterPhones: parseStringArray(body.requester_phones),
      });

      return response.status(200).json({ ok: true, ...result });
    } catch (error: unknown) {
      return handleError(error, response, 'resolve');
    }
  };
}

export function createManualTicketWhatsappStartTemplateController(service: ManualTicketWhatsappLinkService) {
  return async (request: Request, response: Response): Promise<Response> => {
    try {
      const ticketId = parsePositiveInteger(request.params.ticket_id);
      const body = (request.body ?? {}) as Record<string, unknown>;
      const result = await service.startTemplate({
        ticketId: ticketId ?? 0,
        requesterName: typeof body.requester_name === 'string' ? body.requester_name : null,
        requesterEmail: typeof body.requester_email === 'string' ? body.requester_email : null,
        requesterPhones: parseStringArray(body.requester_phones),
        phoneE164: typeof body.phone_e164 === 'string' ? body.phone_e164 : '',
        glpiUserId: parsePositiveInteger(body.glpi_user_id) ?? 0,
        templateName: typeof body.template_name === 'string' ? body.template_name : '',
        language: typeof body.language === 'string' ? body.language : 'pt_BR',
        manualConfirmation: body.manual_confirmation === true,
        costAcknowledged: body.cost_acknowledged === true,
        templateApproved: body.template_approved === true,
        templateActive: body.template_active === true,
        idempotencyKey: typeof body.idempotency_key === 'string' ? body.idempotency_key : null,
      });

      return response.status(201).json({ ok: true, ...result });
    } catch (error: unknown) {
      return handleError(error, response, 'start_template');
    }
  };
}
