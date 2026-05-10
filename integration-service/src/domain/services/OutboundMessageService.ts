import { randomUUID } from 'node:crypto';

import type { MetaClient, MetaErrorDetail } from '../../adapters/meta/MetaClient.js';
import { extractMetaError } from '../../adapters/meta/MetaClient.js';
import { GlpiRequestError } from '../../errors/GlpiRequestError.js';
import { logger } from '../../infra/logger/logger.js';
import type { ConversationRepository } from '../../repositories/contracts/ConversationRepository.js';
import type { MessageRepository } from '../../repositories/contracts/MessageRepository.js';
import type { AuditService } from './AuditService.js';
import { createCorrelationId } from './correlationId.js';

export interface OutboundMessageRequestBody {
  ticket_id: number;
  conversation_id: string;
  text: string;
  message_type: 'text';
  glpi_user_id: number;
  idempotency_key?: string;
}

export interface SolutionApprovalNotificationRequestBody {
  ticket_id: number;
  conversation_id: string;
  glpi_user_id: number;
  idempotency_key?: string;
  solution_id?: number;
  solution_content?: string;
  solution_status?: number;
}

export type OutboundSuccessBody = {
  status: 'sent';
  message_id: string;
  conversation_id: string;
  postgres_message_row_id: string;
  idempotent: boolean;
};

export type OutboundFailureBody = {
  status: 'failed';
  error_code: string;
  message: string;
  meta_http_status?: number;
  meta_error?: MetaErrorDetail;
};

export type OutboundResponseBody = OutboundSuccessBody | OutboundFailureBody;

export interface OutboundSendResult {
  httpStatus: number;
  body: OutboundResponseBody;
}

export interface OutboundSendOptions {
  correlationId?: string;
}

function extractMetaMessageId(body: unknown): string {
  if (body && typeof body === 'object' && 'messages' in body) {
    const messages = (body as { messages?: Array<{ id?: string }> }).messages;
    const id = messages?.[0]?.id;
    if (typeof id === 'string' && id.length > 0) {
      return id;
    }
  }

  throw new Error('Meta API response did not include messages[0].id.');
}

function digitsOnlyForMeta(phoneE164: string): string {
  return phoneE164.replace(/\D/g, '');
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (match, code: string) => {
      const point = Number.parseInt(code, 10);
      return Number.isFinite(point) && point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : match;
    })
    .replace(/&#x([0-9a-f]+);/gi, (match, code: string) => {
      const point = Number.parseInt(code, 16);
      return Number.isFinite(point) && point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : match;
    })
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#039;/gi, "'")
    .replace(/&apos;/gi, "'");
}

function sanitizeSolutionContent(content: string | undefined, limit = 1200): string {
  if (content === undefined) {
    return '';
  }

  const withoutDangerousBlocks = content
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
  const withLineBreaks = withoutDangerousBlocks
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|li|tr|h[1-6])\s*>/gi, '\n');
  const decoded = decodeHtmlEntities(withLineBreaks.replace(/<[^>]+>/g, ''));
  const normalized = decoded
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return normalized.length > limit ? `${normalized.slice(0, limit).trimEnd()}...` : normalized;
}

function buildSolutionNotificationText(ticketId: number, solutionContent?: string): string {
  const sanitizedSolution = sanitizeSolutionContent(solutionContent);
  if (sanitizedSolution.length === 0) {
    return `Seu chamado #${ticketId} foi solucionado. Como deseja prosseguir?`;
  }

  return [
    `Seu chamado #${ticketId} foi solucionado.`,
    '',
    'Solução:',
    sanitizedSolution,
    '',
    'Como deseja prosseguir?',
  ].join('\n');
}

function previewText(text: string, limit = 500): string {
  return text.length > limit ? `${text.slice(0, limit).trimEnd()}...` : text;
}

export class OutboundMessageService {
  public constructor(
    private readonly conversationRepository: ConversationRepository,
    private readonly messageRepository: MessageRepository,
    private readonly metaClient: MetaClient,
    private readonly outboundSendMode: 'mock' | 'real',
    private readonly metaPhoneNumberId: string,
    private readonly auditService: AuditService | null = null,
  ) {}

  public async send(body: OutboundMessageRequestBody, options: OutboundSendOptions = {}): Promise<OutboundSendResult> {
    const correlationId = options.correlationId ?? createCorrelationId();
    const idempotencyKey = body.idempotency_key?.trim() ?? '';
    const normalizedIdempotency = idempotencyKey.length > 0 ? idempotencyKey : null;

    logger.info(
      {
        ticket_id: body.ticket_id,
        conversation_id: body.conversation_id,
        correlation_id: correlationId,
        event_type: 'MESSAGE_RECEIVED',
        status: 'pending',
        glpi_user_id: body.glpi_user_id,
        idempotency_key: normalizedIdempotency,
        outbound_send_mode: this.outboundSendMode,
      },
      '[integration-service][outbound][REQUEST]',
    );
    this.recordAudit({
      correlationId,
      ticketId: body.ticket_id,
      conversationId: body.conversation_id,
      direction: 'outbound',
      eventType: 'MESSAGE_RECEIVED',
      status: 'pending',
      severity: 'info',
      source: 'OutboundMessageService',
      payload: {
        glpi_user_id: body.glpi_user_id,
        message_type: body.message_type,
        idempotency_key: normalizedIdempotency,
      },
    });

    if (normalizedIdempotency !== null) {
      const existing = await this.messageRepository.findByIdempotencyKey(normalizedIdempotency);
      if (existing !== null) {
        logger.info(
          {
            ticket_id: body.ticket_id,
            conversation_id: body.conversation_id,
            message_id: existing.messageId,
            correlation_id: correlationId,
            event_type: 'MESSAGE_SENT',
            status: 'duplicated',
            postgres_message_row_id: existing.id,
            idempotency_key: normalizedIdempotency,
          },
          '[integration-service][outbound][SEND]',
        );
        this.recordAudit({
          correlationId,
          ticketId: body.ticket_id,
          conversationId: existing.conversationId ?? body.conversation_id,
          messageId: existing.messageId,
          direction: 'outbound',
          eventType: 'MESSAGE_SENT',
          status: 'duplicated',
          severity: 'info',
          source: 'OutboundMessageService',
        });

        return {
          httpStatus: 200,
          body: {
            status: 'sent',
            message_id: existing.messageId,
            conversation_id: existing.conversationId ?? body.conversation_id,
            postgres_message_row_id: existing.id,
            idempotent: true,
          },
        };
      }
    }

    const conversation = await this.conversationRepository.findByIdAndGlpiTicketId(
      body.conversation_id,
      body.ticket_id,
    );

    if (conversation === null) {
      logger.error(
        {
          ticket_id: body.ticket_id,
          conversation_id: body.conversation_id,
          correlation_id: correlationId,
          event_type: 'MESSAGE_FAILED',
          status: 'failed',
          error_code: 'CONVERSATION_NOT_FOUND',
        },
        '[integration-service][outbound][ERROR]',
      );
      this.recordAudit({
        correlationId,
        ticketId: body.ticket_id,
        conversationId: body.conversation_id,
        direction: 'outbound',
        eventType: 'MESSAGE_FAILED',
        status: 'failed',
        severity: 'warning',
        source: 'OutboundMessageService',
        errorMessage: 'CONVERSATION_NOT_FOUND',
      });

      return {
        httpStatus: 404,
        body: {
          status: 'failed',
          error_code: 'CONVERSATION_NOT_FOUND',
          message: 'Conversation not found for this ticket_id and conversation_id.',
        },
      };
    }

    if (conversation.status === 'closed') {
      logger.error(
        {
          ticket_id: body.ticket_id,
          conversation_id: body.conversation_id,
          correlation_id: correlationId,
          event_type: 'MESSAGE_FAILED',
          status: 'failed',
          error_code: 'CONVERSATION_CLOSED',
        },
        '[integration-service][outbound][ERROR]',
      );
      this.recordAudit({
        correlationId,
        ticketId: body.ticket_id,
        conversationId: body.conversation_id,
        direction: 'outbound',
        eventType: 'MESSAGE_FAILED',
        status: 'failed',
        severity: 'warning',
        source: 'OutboundMessageService',
        errorMessage: 'CONVERSATION_CLOSED',
      });

      return {
        httpStatus: 409,
        body: {
          status: 'failed',
          error_code: 'CONVERSATION_CLOSED',
          message: 'Cannot send outbound messages to a closed conversation.',
        },
      };
    }

    const recipientPhone = conversation.phoneE164;
    const senderPhone = `whatsapp:${this.metaPhoneNumberId}`;
    const toForMeta = digitsOnlyForMeta(recipientPhone);

    let messageId: string;
    let metaResponse: unknown;

    if (this.outboundSendMode === 'mock') {
      messageId = `mock.wamid.${randomUUID()}`;
      metaResponse = {
        mode: 'mock',
        skipped_meta_api: true,
      };

      logger.info(
        {
          ticket_id: body.ticket_id,
          conversation_id: body.conversation_id,
          message_id: messageId,
          correlation_id: correlationId,
          event_type: 'MESSAGE_SENT',
          status: 'success',
          glpi_user_id: body.glpi_user_id,
        },
        '[integration-service][outbound][MOCK_SEND]',
      );
    } else {
      try {
        metaResponse = await this.metaClient.sendTextMessage({
          to: toForMeta,
          body: body.text,
        });
        messageId = extractMetaMessageId(metaResponse);
      } catch (error: unknown) {
        const httpStatus  = error instanceof GlpiRequestError ? error.statusCode   : undefined;
        const metaBody    = error instanceof GlpiRequestError ? error.responseBody : undefined;
        const metaError   = extractMetaError(metaBody);

        const isAuthError = httpStatus === 401 || metaError?.code === 190;
        const errorCode   = isAuthError ? 'META_AUTH_ERROR' : 'META_SEND_FAILED';
        const errorMsg    = isAuthError
          ? 'Token da Meta inválido ou expirado.'
          : (error instanceof Error ? error.message : 'Meta send failed.');

        logger.error(
          {
            ticket_id:          body.ticket_id,
            conversation_id:    body.conversation_id,
            correlation_id:     correlationId,
            event_type:         'META_API_FAILED',
            status:             'failed',
            error_code:         errorCode,
            meta_http_status:   httpStatus,
            meta_response_body: metaBody,
            meta_error:         metaError,
          },
          '[integration-service][outbound][ERROR]',
        );
        this.recordAudit({
          correlationId,
          ticketId: body.ticket_id,
          conversationId: body.conversation_id,
          direction: 'outbound',
          eventType: 'META_API_FAILED',
          status: 'failed',
          severity: 'error',
          source: 'OutboundMessageService',
          errorMessage: errorMsg,
          payload: {
            error_code: errorCode,
            meta_http_status: httpStatus,
            meta_error: metaError,
          },
        });

        return {
          httpStatus: 502,
          body: {
            status:           'failed',
            error_code:       errorCode,
            message:          errorMsg,
            meta_http_status: httpStatus,
            meta_error:       metaError,
          },
        };
      }
    }

    const rawPayload = {
      outbound_send_mode: this.outboundSendMode,
      glpi_user_id: body.glpi_user_id,
      ticket_id: body.ticket_id,
      request: {
        text: body.text,
        message_type: body.message_type,
        recipient_phone: recipientPhone,
        to_for_meta: toForMeta,
      },
      response: metaResponse,
    };

    const inserted = await this.messageRepository.insertOutbound({
      messageId,
      conversationId: conversation.id,
      senderPhone,
      recipientPhone,
      messageType: body.message_type,
      messageText: body.text,
      rawPayload,
      processingStatus: 'sent',
      glpiSyncStatus: 'synced',
      idempotencyKey: normalizedIdempotency,
    });

    await this.conversationRepository.touch(conversation.id, new Date());

    logger.info(
      {
        ticket_id: body.ticket_id,
        conversation_id: conversation.id,
        message_id: inserted.messageId,
        correlation_id: correlationId,
        event_type: 'MESSAGE_SENT',
        status: 'success',
        postgres_message_row_id: inserted.id,
        glpi_user_id: body.glpi_user_id,
        idempotency_key: normalizedIdempotency,
        outbound_send_mode: this.outboundSendMode,
      },
      '[integration-service][outbound][SEND]',
    );
    this.recordAudit({
      correlationId,
      ticketId: body.ticket_id,
      conversationId: conversation.id,
      messageId: inserted.messageId,
      direction: 'outbound',
      eventType: 'MESSAGE_SENT',
      status: 'success',
      severity: 'info',
      source: 'OutboundMessageService',
      payload: {
        postgres_message_row_id: inserted.id,
        outbound_send_mode: this.outboundSendMode,
      },
    });

    return {
      httpStatus: 201,
      body: {
        status: 'sent',
        message_id: inserted.messageId,
        conversation_id: conversation.id,
        postgres_message_row_id: inserted.id,
        idempotent: false,
      },
    };
  }

  public async sendSolutionApprovalRequest(
    body: SolutionApprovalNotificationRequestBody,
    options: OutboundSendOptions = {},
  ): Promise<OutboundSendResult> {
    const correlationId = options.correlationId ?? createCorrelationId();
    const idempotencyKey = body.idempotency_key?.trim()
      || `notify_ticket_solved_${body.ticket_id}_${body.conversation_id}_interactive`;

    logger.info(
      {
        ticket_id: body.ticket_id,
        conversation_id: body.conversation_id,
        correlation_id: correlationId,
        event_type: 'TICKET_CLOSED',
        status: 'pending',
        glpi_user_id: body.glpi_user_id,
        idempotency_key: idempotencyKey,
        outbound_send_mode: this.outboundSendMode,
      },
      '[integration-service][notification][solution][REQUEST]',
    );

    const existing = await this.messageRepository.findByIdempotencyKey(idempotencyKey);
    if (existing !== null) {
      this.recordAudit({
        correlationId,
        ticketId: body.ticket_id,
        conversationId: existing.conversationId ?? body.conversation_id,
        messageId: existing.messageId,
        direction: 'outbound',
        eventType: 'TICKET_CLOSED',
        status: 'duplicated',
        severity: 'info',
        source: 'OutboundMessageService',
      });
      return {
        httpStatus: 200,
        body: {
          status: 'sent',
          message_id: existing.messageId,
          conversation_id: existing.conversationId ?? body.conversation_id,
          postgres_message_row_id: existing.id,
          idempotent: true,
        },
      };
    }

    const conversation = await this.conversationRepository.findByIdAndGlpiTicketId(
      body.conversation_id,
      body.ticket_id,
    );

    if (conversation === null) {
      this.recordAudit({
        correlationId,
        ticketId: body.ticket_id,
        conversationId: body.conversation_id,
        direction: 'outbound',
        eventType: 'GLPI_SYNC_FAILED',
        status: 'failed',
        severity: 'warning',
        source: 'OutboundMessageService',
        errorMessage: 'CONVERSATION_NOT_FOUND',
      });
      return {
        httpStatus: 404,
        body: {
          status: 'failed',
          error_code: 'CONVERSATION_NOT_FOUND',
          message: 'Conversation not found for this ticket_id and conversation_id.',
        },
      };
    }

    const recipientPhone = conversation.phoneE164;
    const senderPhone = `whatsapp:${this.metaPhoneNumberId}`;
    const toForMeta = digitsOnlyForMeta(recipientPhone);
    const interactiveText = buildSolutionNotificationText(body.ticket_id, body.solution_content);
    const fallbackText = interactiveText;
    const buttons = [
      {
        id: `solution_approve:${body.ticket_id}:${body.conversation_id}`,
        title: 'Aprovar',
      },
      {
        id: `solution_reopen:${body.ticket_id}:${body.conversation_id}`,
        title: 'Reabrir',
      },
    ];

    let messageId: string;
    let metaResponse: unknown;
    let sendMode: 'interactive' | 'text_fallback' | 'mock' = 'interactive';

    if (this.outboundSendMode === 'mock') {
      messageId = `mock.wamid.${randomUUID()}`;
      metaResponse = {
        mode: 'mock',
        skipped_meta_api: true,
        buttons,
      };
      sendMode = 'mock';
    } else {
      try {
        metaResponse = await this.metaClient.sendReplyButtons(toForMeta, interactiveText, buttons);
        messageId = extractMetaMessageId(metaResponse);
      } catch (error: unknown) {
        logger.warn(
          {
            ticket_id: body.ticket_id,
            conversation_id: body.conversation_id,
            correlation_id: correlationId,
            event_type: 'META_API_FAILED',
            status: 'failed',
            error_message: error instanceof Error ? error.message : String(error),
          },
          '[integration-service][notification][solution][INTERACTIVE_FALLBACK_TEXT]',
        );
        metaResponse = await this.metaClient.sendTextMessage({
          to: toForMeta,
          body: fallbackText,
        });
        messageId = extractMetaMessageId(metaResponse);
        sendMode = 'text_fallback';
      }
    }

    const inserted = await this.messageRepository.insertOutbound({
      messageId,
      conversationId: conversation.id,
      senderPhone,
      recipientPhone,
      messageType: 'text',
      messageText: sendMode === 'text_fallback' ? fallbackText : interactiveText,
      rawPayload: {
        outbound_send_mode: this.outboundSendMode,
        notification_type: 'ticket_solved_solution_buttons',
        glpi_user_id: body.glpi_user_id,
        ticket_id: body.ticket_id,
        solution_id: body.solution_id ?? null,
        solution_status: body.solution_status ?? null,
        request: {
          message_type: sendMode,
          recipient_phone: recipientPhone,
          to_for_meta: toForMeta,
          body_text_preview: previewText(interactiveText),
          has_solution_content: Boolean(body.solution_content?.trim()),
          buttons,
        },
        response: metaResponse,
      },
      processingStatus: 'sent',
      glpiSyncStatus: 'synced',
      idempotencyKey,
    });

    await this.conversationRepository.touch(conversation.id, new Date());

    logger.info(
      {
        ticket_id: body.ticket_id,
        conversation_id: conversation.id,
        message_id: inserted.messageId,
        correlation_id: correlationId,
        event_type: 'MESSAGE_SENT',
        status: 'success',
        postgres_message_row_id: inserted.id,
        idempotency_key: idempotencyKey,
        send_mode: sendMode,
      },
      '[integration-service][notification][solution][SEND]',
    );
    this.recordAudit({
      correlationId,
      ticketId: body.ticket_id,
      conversationId: conversation.id,
      messageId: inserted.messageId,
      direction: 'outbound',
      eventType: 'TICKET_CLOSED',
      status: 'success',
      severity: 'info',
      source: 'OutboundMessageService',
      payload: {
        notification_type: 'ticket_solved_solution_buttons',
        postgres_message_row_id: inserted.id,
        send_mode: sendMode,
      },
    });

    return {
      httpStatus: 201,
      body: {
        status: 'sent',
        message_id: inserted.messageId,
        conversation_id: conversation.id,
        postgres_message_row_id: inserted.id,
        idempotent: false,
      },
    };
  }

  private recordAudit(input: Parameters<AuditService['recordAuditEventFireAndForget']>[0]): void {
    this.auditService?.recordAuditEventFireAndForget(input);
  }
}
