import type { Request, Response } from 'express';
import {
  EntitySelectionError,
  type EntitySelectionService,
} from '../domain/services/EntitySelectionService.js';
import { logger } from '../infra/logger/logger.js';

function parseInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }

  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return Number.parseInt(value.trim(), 10);
  }

  return null;
}

function parseBoolean(value: unknown): boolean {
  if (value === true) {
    return true;
  }

  if (typeof value === 'string') {
    return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
  }

  return false;
}

export function createConversationEntityController(entitySelectionService: EntitySelectionService) {
  return async (request: Request, response: Response) => {
    try {
      const conversationId = String(request.params.conversation_id ?? '').trim();
      const glpiEntityId = parseInteger(
        request.body?.glpi_entity_id ?? request.body?.entity_id ?? request.body?.glpiEntityId,
      );
      const glpiUserId = parseInteger(request.body?.glpi_user_id ?? request.body?.glpiUserId);
      const glpiEntityName =
        typeof request.body?.glpi_entity_name === 'string'
          ? request.body.glpi_entity_name.trim()
          : null;
      const idempotencyKey =
        typeof request.body?.idempotency_key === 'string'
          ? request.body.idempotency_key.trim()
          : null;

      if (!conversationId) {
        return response.status(400).json({
          status: 'failed',
          error_code: 'CONVERSATION_ID_REQUIRED',
          message: 'conversation_id obrigatório.',
        });
      }

      if (!glpiEntityId || glpiEntityId <= 0) {
        return response.status(400).json({
          status: 'failed',
          error_code: 'INVALID_ENTITY',
          message: 'Entidade GLPI inválida.',
        });
      }

      if (!parseBoolean(request.body?.permission_validated ?? request.body?.permissionValidated)) {
        return response.status(403).json({
          status: 'failed',
          error_code: 'PERMISSION_NOT_VALIDATED',
          message: 'Permissão para confirmar entidade não validada.',
        });
      }

      const result = await entitySelectionService.confirmEntity({
        conversationId,
        glpiEntityId,
        glpiEntityName,
        glpiUserId,
        createTicket: parseBoolean(request.body?.create_ticket ?? request.body?.createTicket),
        idempotencyKey,
      });

      const statusCode = result.status === 'processing'
        ? 202
        : result.idempotent === true
          ? 200
          : 201;

      return response.status(statusCode).json({
        status: result.status,
        conversation_id: result.conversationId,
        glpi_ticket_id: result.glpiTicketId ?? null,
        idempotent: result.idempotent ?? false,
        message: result.message,
        warning: result.warning ?? null,
      });
    } catch (error) {
      if (error instanceof EntitySelectionError) {
        const rawEntityId = request.body?.glpi_entity_id ?? request.body?.entity_id ?? request.body?.glpiEntityId;
        const parsedEntityId = parseInteger(rawEntityId);
        logger.warn(
          {
            conversation_id: String(request.params.conversation_id ?? '').trim(),
            has_glpi_entity_id: rawEntityId !== undefined && rawEntityId !== null && String(rawEntityId).trim() !== '',
            parsed_glpi_entity_id: parsedEntityId,
            has_idempotency_key:
              typeof request.body?.idempotency_key === 'string' && request.body.idempotency_key.trim() !== '',
            conversation_status: typeof error.details.status === 'string' ? error.details.status : undefined,
            glpi_stage: typeof error.details.glpi_stage === 'string' ? error.details.glpi_stage : undefined,
            glpi_status_code: typeof error.details.glpi_status_code === 'number' ? error.details.glpi_status_code : undefined,
            glpi_request_url: typeof error.details.glpi_request_url === 'string' ? error.details.glpi_request_url : undefined,
            timeout_ms: typeof error.details.timeout_ms === 'number' ? error.details.timeout_ms : undefined,
            error_type: typeof error.details.error_type === 'string' ? error.details.error_type : undefined,
            error_code: error.errorCode,
          },
          '[integration-service][entity_selection][EXPECTED_ERROR]',
        );
        return response.status(error.statusCode).json({
          status: 'failed',
          error_code: error.errorCode,
          message: error.message,
          details: error.details,
        });
      }

      const rawEntityId = request.body?.glpi_entity_id ?? request.body?.entity_id ?? request.body?.glpiEntityId;
      const parsedEntityId = parseInteger(rawEntityId);
      logger.error(
        {
          conversation_id: String(request.params.conversation_id ?? '').trim(),
          has_glpi_entity_id: rawEntityId !== undefined && rawEntityId !== null && String(rawEntityId).trim() !== '',
          parsed_glpi_entity_id: parsedEntityId,
          has_idempotency_key:
            typeof request.body?.idempotency_key === 'string' && request.body.idempotency_key.trim() !== '',
          error_message: error instanceof Error ? error.message : String(error),
        },
        '[integration-service][entity_selection][UNEXPECTED_ERROR]',
      );
      return response.status(500).json({
        status: 'failed',
        error_code: 'ENTITY_SELECTION_FAILED',
        message: 'Falha inesperada ao confirmar entidade.',
      });
    }
  };
}

export function createConversationEntityStatusController(entitySelectionService: EntitySelectionService) {
  return async (request: Request, response: Response) => {
    try {
      const conversationId = String(request.params.conversation_id ?? '').trim();
      const result = await entitySelectionService.getEntitySelectionStatus(conversationId);

      return response.status(200).json({
        status: result.status,
        conversation_id: result.conversationId,
        glpi_ticket_id: result.glpiTicketId ?? null,
        glpi_entity_id: result.glpiEntityId ?? null,
        glpi_entity_name: result.glpiEntityName ?? null,
        error_type: result.errorType ?? null,
        error_message: result.errorMessage ?? null,
        started_at: result.startedAt ?? null,
        finished_at: result.finishedAt ?? null,
        duration_seconds: result.durationSeconds ?? null,
        message: result.message,
      });
    } catch (error) {
      if (error instanceof EntitySelectionError) {
        return response.status(error.statusCode).json({
          status: 'failed',
          error_code: error.errorCode,
          message: error.message,
          details: error.details,
        });
      }

      logger.error(
        {
          conversation_id: String(request.params.conversation_id ?? '').trim(),
          error_message: error instanceof Error ? error.message : String(error),
        },
        '[integration-service][entity_selection_status][UNEXPECTED_ERROR]',
      );
      return response.status(500).json({
        status: 'failed',
        error_code: 'ENTITY_SELECTION_STATUS_FAILED',
        message: 'Falha inesperada ao consultar status da tentativa.',
      });
    }
  };
}
