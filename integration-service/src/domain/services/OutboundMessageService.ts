import { randomUUID } from 'node:crypto';

import type { MetaClient, MetaErrorDetail } from '../../adapters/meta/MetaClient.js';
import { extractMetaError } from '../../adapters/meta/MetaClient.js';
import { GlpiRequestError } from '../../errors/GlpiRequestError.js';
import { logger } from '../../infra/logger/logger.js';
import type { ConversationRepository } from '../../repositories/contracts/ConversationRepository.js';
import type { InactivityTrackingRepository } from '../../repositories/contracts/InactivityTrackingRepository.js';
import type { MessageRepository } from '../../repositories/contracts/MessageRepository.js';
import type { AuditService } from './AuditService.js';
import { AttachmentSecurityService } from './AttachmentSecurityService.js';
import { createCorrelationId } from './correlationId.js';
import type { MessageConfigurationService } from './MessageConfigurationService.js';

export interface OutboundMessageRequestBody {
  ticket_id: number;
  conversation_id: string;
  text: string;
  message_type: 'text' | 'document' | 'image' | 'audio' | 'video' | 'interactive_buttons' | 'interactive_list' | 'template';
  glpi_user_id: number;
  idempotency_key?: string;
  template_name?: string;
  language?: string;
  template_parameters?: string[];
  buttons?: Array<{ id: string; title: string }>;
  list_options?: Array<{ id: string; title: string; description?: string }>;
  media?: {
    filename: string;
    mime_type: string;
    content_base64: string;
    document_id?: number;
  };
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

export type OutboundIgnoredBody = {
  status: 'ignored';
  error_code: string;
  message: string;
};

export type OutboundResponseBody = OutboundSuccessBody | OutboundFailureBody | OutboundIgnoredBody;

export interface OutboundSendResult {
  httpStatus: number;
  body: OutboundResponseBody;
}

export interface OutboundSendOptions {
  correlationId?: string;
}

export interface ProfileCollectionReminderSendInput {
  conversationId: string;
  phoneE164: string;
  text: string;
  messageType: 'text' | 'interactive_buttons' | 'interactive_list' | 'template';
  templateName?: string | null;
  language?: string | null;
  buttons?: Array<{ id: string; title: string }>;
  listOptions?: Array<{ id: string; title: string; description?: string }>;
  idempotencyKey: string;
  eventKey: string;
  profileStep: string;
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
    return `Seu chamado #${ticketId} foi solucionado. Como você avalia este atendimento?`;
  }

  return [
    `Seu chamado #${ticketId} foi solucionado.`,
    '',
    'Solução:',
    sanitizedSolution,
    '',
    'Como você avalia este atendimento?',
  ].join('\n');
}

function applyMessageTemplate(text: string, values: Record<string, string | number | null | undefined>): string {
  return text.replace(/\{([a-zA-Z0-9_]+)\}|#\{([a-zA-Z0-9_]+)\}/g, (match, keyA: string, keyB: string) => {
    const key = keyA || keyB;
    const value = values[key];

    return value === null || value === undefined ? match : String(value);
  });
}

const OUTBOUND_MEDIA_MIME_ALLOWLIST = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv',
  'image/jpeg',
  'image/png',
  'image/webp',
  'audio/ogg',
  'audio/mpeg',
  'audio/mp4',
  'audio/aac',
  'audio/webm',
  'video/mp4',
  'video/3gpp',
]);
const OUTBOUND_MEDIA_LIMITS_BYTES: Record<'document' | 'image' | 'audio' | 'video', number> = {
  document: 15_728_640,
  image: 15_728_640,
  audio: 16 * 1024 * 1024,
  video: 64 * 1024 * 1024,
};
const WHATSAPP_CUSTOMER_CARE_WINDOW_MS = 24 * 60 * 60 * 1000;
const MANUAL_WINDOW_CLOSED_ERROR_CODE = 'WINDOW_24H_CLOSED_TEMPLATE_REQUIRED';
const MANUAL_TEMPLATE_NOT_ALLOWED_ERROR_CODE = 'TEMPLATE_NOT_ALLOWED';
const CONTROLLED_MANUAL_TEMPLATE_NAMES = new Set(['aviso_atendimento_fora_janela']);
const INACTIVITY_AUTOCLOSE_REASON = 'Encerrado por falta de retorno do usuário';
const attachmentSecurityService = new AttachmentSecurityService();

function normalizeMimeType(value: string | undefined): string {
  return (value ?? '').split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

function fallbackAttachmentText(): string {
  return 'Não consegui enviar o anexo pelo WhatsApp. Acesse o GLPI para visualizar o arquivo.';
}

function previewText(text: string, limit = 500): string {
  return text.length > limit ? `${text.slice(0, limit).trimEnd()}...` : text;
}

function isInactivityAutocloseContent(text: string | undefined): boolean {
  return Boolean(text?.includes(INACTIVITY_AUTOCLOSE_REASON));
}

export class OutboundMessageService {
  public constructor(
    private readonly conversationRepository: ConversationRepository,
    private readonly messageRepository: MessageRepository,
    private readonly metaClient: MetaClient,
    private readonly outboundSendMode: 'mock' | 'real',
    private readonly metaPhoneNumberId: string,
    private readonly auditService: AuditService | null = null,
    private readonly inactivityTrackingRepository: InactivityTrackingRepository | null = null,
    private readonly messageConfigurationService: MessageConfigurationService | null = null,
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

    if (isInactivityAutocloseContent(body.text) && normalizedIdempotency?.startsWith('notify_followup')) {
      logger.info(
        {
          ticket_id: body.ticket_id,
          conversation_id: body.conversation_id,
          correlation_id: correlationId,
          event_type: 'MESSAGE_IGNORED',
          status: 'ignored',
          error_code: 'INACTIVITY_AUTOCLOSE_FOLLOWUP_SUPPRESSED',
          idempotency_key: normalizedIdempotency,
        },
        '[integration-service][outbound][IGNORED_INACTIVITY_AUTOCLOSE_FOLLOWUP]',
      );
      this.recordAudit({
        correlationId,
        ticketId: body.ticket_id,
        conversationId: body.conversation_id,
        direction: 'outbound',
        eventType: 'MESSAGE_IGNORED',
        status: 'ignored',
        severity: 'info',
        source: 'OutboundMessageService',
        errorMessage: 'INACTIVITY_AUTOCLOSE_FOLLOWUP_SUPPRESSED',
        payload: {
          idempotency_key: normalizedIdempotency,
          reason: 'inactivity_autoclose_followup_already_notified',
        },
      });

      return {
        httpStatus: 200,
        body: {
          status: 'ignored',
          error_code: 'INACTIVITY_AUTOCLOSE_FOLLOWUP_SUPPRESSED',
          message: 'Inactivity autoclose follow-up notification suppressed because the autoclose notice was already sent.',
        },
      };
    }

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
      logger.warn(
        {
          ticket_id: body.ticket_id,
          conversation_id: body.conversation_id,
          correlation_id: correlationId,
          event_type: 'MESSAGE_IGNORED',
          status: 'ignored',
          error_code: 'CONVERSATION_CLOSED',
        },
        '[integration-service][outbound][IGNORED_CLOSED_CONVERSATION]',
      );
      this.recordAudit({
        correlationId,
        ticketId: body.ticket_id,
        conversationId: body.conversation_id,
        direction: 'outbound',
        eventType: 'MESSAGE_IGNORED',
        status: 'ignored',
        severity: 'info',
        source: 'OutboundMessageService',
        errorMessage: 'CONVERSATION_CLOSED',
        payload: {
          error_code: 'CONVERSATION_CLOSED',
          message_type: body.message_type,
          reason: 'closed_conversation_guard',
        },
      });

      return {
        httpStatus: 200,
        body: {
          status: 'ignored',
          error_code: 'CONVERSATION_CLOSED',
          message: 'Outbound message ignored because the conversation is closed.',
        },
      };
    }

    const recipientPhone = conversation.phoneE164;
    const senderPhone = `whatsapp:${this.metaPhoneNumberId}`;
    const toForMeta = digitsOnlyForMeta(recipientPhone);

    if (body.message_type === 'text' && body.glpi_user_id > 0) {
      const guard = await this.guardManualTextWindow({
        body,
        conversationId: conversation.id,
        correlationId,
      });
      if (guard !== null) {
        return guard;
      }
    }

    if (body.message_type === 'template' && body.glpi_user_id > 0) {
      const guard = this.guardManualTemplate(body, conversation.id, correlationId);
      if (guard !== null) {
        return guard;
      }
    }

    if (
      body.message_type === 'document'
      || body.message_type === 'image'
      || body.message_type === 'audio'
      || body.message_type === 'video'
    ) {
      return this.sendOutboundMedia({
        body: body as OutboundMessageRequestBody & { message_type: 'document' | 'image' | 'audio' | 'video' },
        conversationId: conversation.id,
        senderPhone,
        recipientPhone,
        toForMeta,
        normalizedIdempotency,
        correlationId,
      });
    }

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
        metaResponse = await this.sendConfiguredMetaMessage(body, toForMeta);
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
        template_name: body.message_type === 'template' ? body.template_name : undefined,
        language: body.message_type === 'template' ? body.language : undefined,
        template_parameters: body.message_type === 'template' ? body.template_parameters : undefined,
        buttons: body.message_type === 'interactive_buttons' ? body.buttons : undefined,
        list_options: body.message_type === 'interactive_list' ? body.list_options : undefined,
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
    await this.trackInactivityOutbound({
      conversationId: conversation.id,
      ticketId: body.ticket_id,
      idempotencyKey: normalizedIdempotency,
    });

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

  public async sendProfileCollectionReminder(
    input: ProfileCollectionReminderSendInput,
    options: OutboundSendOptions = {},
  ): Promise<OutboundSendResult> {
    const correlationId = options.correlationId ?? createCorrelationId();
    const normalizedIdempotency = input.idempotencyKey.trim();
    const senderPhone = `whatsapp:${this.metaPhoneNumberId}`;
    const recipientPhone = input.phoneE164;
    const toForMeta = digitsOnlyForMeta(recipientPhone);
    const body: OutboundMessageRequestBody = {
      ticket_id: 0,
      conversation_id: input.conversationId,
      text: input.text,
      message_type: input.messageType,
      glpi_user_id: 0,
      idempotency_key: normalizedIdempotency,
      ...(input.templateName ? { template_name: input.templateName } : {}),
      ...(input.language ? { language: input.language } : {}),
      ...(input.buttons ? { buttons: input.buttons } : {}),
      ...(input.listOptions ? { list_options: input.listOptions } : {}),
    };

    let messageId: string;
    let metaResponse: unknown;

    if (this.outboundSendMode === 'mock') {
      messageId = `mock.wamid.${randomUUID()}`;
      metaResponse = {
        mode: 'mock',
        skipped_meta_api: true,
      };
    } else {
      try {
        metaResponse = await this.sendConfiguredMetaMessage(body, toForMeta);
        messageId = extractMetaMessageId(metaResponse);
      } catch (error: unknown) {
        const httpStatus = error instanceof GlpiRequestError ? error.statusCode : undefined;
        const metaBody = error instanceof GlpiRequestError ? error.responseBody : undefined;
        const metaError = extractMetaError(metaBody);
        const message = error instanceof Error ? error.message : 'Meta send failed.';
        logger.error(
          {
            conversation_id: input.conversationId,
            correlation_id: correlationId,
            event_type: 'PROFILE_COLLECTION_REMINDER_FAILED',
            status: 'failed',
            meta_http_status: httpStatus,
            meta_error: metaError,
            profile_step: input.profileStep,
          },
          '[integration-service][outbound][PROFILE_COLLECTION_REMINDER_FAILED]',
        );

        return {
          httpStatus: httpStatus ?? 502,
          body: {
            status: 'failed',
            error_code: 'PROFILE_COLLECTION_REMINDER_FAILED',
            message,
            ...(httpStatus ? { meta_http_status: httpStatus } : {}),
            ...(metaError ? { meta_error: metaError } : {}),
          },
        };
      }
    }

    const inserted = await this.messageRepository.insertOutbound({
      messageId,
      conversationId: input.conversationId,
      senderPhone,
      recipientPhone,
      messageType: input.messageType,
      messageText: input.text,
      rawPayload: {
        automation_event_key: input.eventKey,
        profile_step: input.profileStep,
        send_type: input.messageType,
        template_name: input.templateName ?? null,
        response: metaResponse,
      },
      processingStatus: 'sent',
      glpiSyncStatus: 'synced',
      idempotencyKey: normalizedIdempotency,
    });

    logger.info(
      {
        conversation_id: input.conversationId,
        message_id: inserted.messageId,
        correlation_id: correlationId,
        event_type: 'PROFILE_COLLECTION_REMINDER_SENT',
        status: 'success',
        postgres_message_row_id: inserted.id,
        idempotency_key: normalizedIdempotency,
      },
      '[integration-service][outbound][PROFILE_COLLECTION_REMINDER_SENT]',
    );

    return {
      httpStatus: 201,
      body: {
        status: 'sent',
        message_id: inserted.messageId,
        conversation_id: input.conversationId,
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

    if (isInactivityAutocloseContent(body.solution_content)) {
      this.recordAudit({
        correlationId,
        ticketId: body.ticket_id,
        conversationId: body.conversation_id,
        direction: 'outbound',
        eventType: 'TICKET_CLOSED',
        status: 'ignored',
        severity: 'info',
        source: 'OutboundMessageService',
        errorMessage: 'INACTIVITY_AUTOCLOSE_SOLUTION_SUPPRESSED',
        payload: {
          idempotency_key: idempotencyKey,
          reason: 'inactivity_autoclose_does_not_send_csat',
        },
      });
      this.recordAudit({
        correlationId,
        ticketId: body.ticket_id,
        conversationId: body.conversation_id,
        direction: 'outbound',
        eventType: 'CSAT_SUPPRESSED_AFTER_AUTOCLOSE',
        status: 'ignored',
        severity: 'info',
        source: 'OutboundMessageService',
        payload: {
          idempotency_key: idempotencyKey,
          reason: 'inactivity_autoclose_does_not_send_csat',
        },
      });
      return {
        httpStatus: 200,
        body: {
          status: 'ignored',
          error_code: 'INACTIVITY_AUTOCLOSE_SOLUTION_SUPPRESSED',
          message: 'Inactivity autoclose solution notification suppressed.',
        },
      };
    }

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
    const configuredNotification = await this.buildSolutionApprovalMessage({
      ticketId: body.ticket_id,
      conversationId: body.conversation_id,
      solutionContent: body.solution_content,
      windowOpen: Date.now() - conversation.lastMessageAt.getTime() < 24 * 60 * 60 * 1000,
    });
    if (!configuredNotification.shouldSend) {
      this.recordAudit({
        correlationId,
        ticketId: body.ticket_id,
        conversationId: body.conversation_id,
        direction: 'outbound',
        eventType: 'TICKET_CLOSED',
        status: 'ignored',
        severity: 'warning',
        source: 'OutboundMessageService',
        errorMessage: configuredNotification.reason ?? 'SOLUTION_NOTIFICATION_NOT_SENT_BY_RULE',
        payload: {
          idempotency_key: idempotencyKey,
          event_key: configuredNotification.eventKey,
          reason: configuredNotification.reason,
        },
      });

      return {
        httpStatus: 200,
        body: {
          status: 'ignored',
          error_code: configuredNotification.reason ?? 'SOLUTION_NOTIFICATION_NOT_SENT_BY_RULE',
          message: 'Solution notification was not sent by configured WhatsApp window/template rule.',
        },
      };
    }

    const interactiveText = configuredNotification.text;
    const fallbackText = configuredNotification.text;
    const buttons = configuredNotification.buttons;

    let messageId: string;
    let metaResponse: unknown;
    let sendMode: 'interactive' | 'text_fallback' | 'template' | 'mock' = configuredNotification.sendType === 'template' ? 'template' : 'interactive';

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
        if (configuredNotification.sendType === 'template' && configuredNotification.templateName) {
          metaResponse = await this.metaClient.sendTemplateMessage({
            to: toForMeta,
            templateName: configuredNotification.templateName,
            language: configuredNotification.language,
          });
        } else {
          metaResponse = await this.metaClient.sendReplyButtons(toForMeta, interactiveText, buttons);
        }
        messageId = extractMetaMessageId(metaResponse);
      } catch (error: unknown) {
        if (configuredNotification.sendType === 'template') {
          const errorMessage = error instanceof Error ? error.message : String(error);
          this.recordAudit({
            correlationId,
            ticketId: body.ticket_id,
            conversationId: body.conversation_id,
            direction: 'outbound',
            eventType: 'TICKET_CLOSED',
            status: 'failed',
            severity: 'error',
            source: 'OutboundMessageService',
            errorMessage,
            payload: {
              event_key: configuredNotification.eventKey,
              template_name: configuredNotification.templateName,
              reason: 'template_send_failed_no_free_text_fallback',
            },
          });

          return {
            httpStatus: 502,
            body: {
              status: 'failed',
              error_code: 'META_TEMPLATE_SEND_FAILED',
              message: errorMessage,
            },
          };
        }

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
        metaResponse = await this.metaClient.sendTextMessage({ to: toForMeta, body: fallbackText });
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
        csat_enabled: true,
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
        csat_enabled: true,
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

  private async sendConfiguredMetaMessage(body: OutboundMessageRequestBody, toForMeta: string): Promise<unknown> {
    if (body.message_type === 'interactive_buttons') {
      const buttons = Array.isArray(body.buttons) ? body.buttons : [];
      if (buttons.length < 1 || buttons.length > 3) {
        throw new Error('INTERACTIVE_BUTTONS_REQUIRE_1_TO_3_OPTIONS');
      }

      return this.metaClient.sendReplyButtons(toForMeta, body.text, buttons);
    }

    if (body.message_type === 'interactive_list') {
      const options = Array.isArray(body.list_options) ? body.list_options : [];
      if (options.length < 1 || options.length > 10) {
        throw new Error('INTERACTIVE_LIST_REQUIRES_1_TO_10_OPTIONS');
      }

      return this.metaClient.sendListMessage(toForMeta, body.text, options);
    }

    if (body.message_type === 'template') {
      const templateName = body.template_name?.trim() ?? '';
      if (templateName === '') {
        throw new Error('TEMPLATE_NAME_REQUIRED');
      }
      const parameters = body.template_parameters
        ?.map((value) => String(value).trim())
        .filter((value) => value !== '');

      return this.metaClient.sendTemplateMessage({
        to: toForMeta,
        templateName,
        language: body.language?.trim() || 'pt_BR',
        ...(parameters && parameters.length > 0 ? { parameters } : {}),
      });
    }

    return this.metaClient.sendTextMessage({
      to: toForMeta,
      body: body.text,
    });
  }

  private async buildSolutionApprovalMessage(input: {
    ticketId: number;
    conversationId: string;
    solutionContent?: string;
    windowOpen: boolean;
  }): Promise<{
    eventKey: string;
    text: string;
    buttons: Array<{ id: string; title: string }>;
    shouldSend: boolean;
    reason: string | null;
    sendType: 'interactive_buttons' | 'template';
    templateName: string | null;
    language: string;
  }> {
    const defaultButtons = [
      { id: `solution_approve:${input.ticketId}:${input.conversationId}`, title: 'Aprovar' },
      { id: `solution_reopen:${input.ticketId}:${input.conversationId}`, title: 'Reabrir' },
    ];
    const fallbackText = buildSolutionNotificationText(input.ticketId, input.solutionContent)
      .replace('Como você avalia este atendimento?', 'Você aprova a solução?');

    if (this.messageConfigurationService === null) {
      return {
        eventKey: 'solution_approve_reopen_prompt',
        text: fallbackText,
        buttons: defaultButtons,
        shouldSend: true,
        reason: null,
        sendType: 'interactive_buttons',
        templateName: null,
        language: 'pt_BR',
      };
    }

    const plan = await this.messageConfigurationService.resolveSendPlan('solution_approve_reopen_prompt', {
      windowOpen: input.windowOpen,
      allowTemplateSend: true,
    });
    const configuredTitles = plan.buttons
      .map((button) => button.title.trim())
      .filter((title) => title !== '')
      .slice(0, 2);
    const buttons = defaultButtons.map((button, index) => ({
      ...button,
      title: configuredTitles[index] ?? button.title,
    }));
    const sanitizedSolution = sanitizeSolutionContent(input.solutionContent);
    let text = applyMessageTemplate(plan.text.trim() !== '' ? plan.text : fallbackText, {
      ticket_id: input.ticketId,
      ticketId: input.ticketId,
      solution: sanitizedSolution,
    });
    if (sanitizedSolution !== '' && !text.includes(sanitizedSolution) && !text.includes('{solution}')) {
      text = [text, '', 'Solução:', sanitizedSolution].join('\n');
    }

    return {
      eventKey: plan.eventKey,
      text,
      buttons,
      shouldSend: plan.shouldSend,
      reason: plan.reason,
      sendType: plan.sendType === 'template' ? 'template' : 'interactive_buttons',
      templateName: plan.templateName,
      language: plan.language || 'pt_BR',
    };
  }

  private async sendOutboundMedia(input: {
    body: OutboundMessageRequestBody & { message_type: 'document' | 'image' | 'audio' | 'video' };
    conversationId: string;
    senderPhone: string;
    recipientPhone: string;
    toForMeta: string;
    normalizedIdempotency: string | null;
    correlationId: string;
  }): Promise<OutboundSendResult> {
    const { body, conversationId, senderPhone, recipientPhone, toForMeta, normalizedIdempotency, correlationId } = input;
    const media = body.media;
    const mimeType = normalizeMimeType(media?.mime_type);

    if (!media || !OUTBOUND_MEDIA_MIME_ALLOWLIST.has(mimeType)) {
      logger.warn(
        {
          ticket_id: body.ticket_id,
          conversation_id: conversationId,
          correlation_id: correlationId,
          event_type: 'OUTBOUND_MEDIA_UNSUPPORTED',
          status: 'failed',
          message_type: body.message_type,
          mime_type: mimeType || null,
        },
        '[integration-service][outbound][OUTBOUND_MEDIA_UNSUPPORTED]',
      );
      return {
        httpStatus: 400,
        body: {
          status: 'failed',
          error_code: 'UNSUPPORTED_MEDIA_TYPE',
          message: 'Unsupported outbound media type.',
        },
      };
    }

    let buffer: Buffer;
    try {
      buffer = Buffer.from(media.content_base64, 'base64');
    } catch {
      return {
        httpStatus: 400,
        body: {
          status: 'failed',
          error_code: 'INVALID_MEDIA_CONTENT',
          message: 'Invalid outbound media content.',
        },
      };
    }

    const maxBytes = OUTBOUND_MEDIA_LIMITS_BYTES[body.message_type];
    if (buffer.byteLength === 0 || buffer.byteLength > maxBytes) {
      logger.warn(
        {
          ticket_id: body.ticket_id,
          conversation_id: conversationId,
          correlation_id: correlationId,
          event_type: 'OUTBOUND_MEDIA_TOO_LARGE',
          status: 'failed',
          message_type: body.message_type,
          mime_type: mimeType,
          filename: media.filename,
          size: buffer.byteLength,
          max_size: maxBytes,
        },
        '[integration-service][outbound][OUTBOUND_MEDIA_TOO_LARGE]',
      );
      return {
        httpStatus: 400,
        body: {
          status: 'failed',
          error_code: 'MEDIA_SIZE_INVALID',
          message: 'Outbound media is empty or exceeds the WhatsApp size limit.',
        },
      };
    }

    const validation = attachmentSecurityService.validate({
      buffer,
      filename: media.filename,
      declaredMime: mimeType,
      messageType: body.message_type,
      maxBytes,
    });
    this.recordAudit({
      correlationId,
      ticketId: body.ticket_id,
      conversationId,
      direction: 'outbound',
      eventType: 'ATTACHMENT_RECEIVED',
      status: 'pending',
      severity: 'info',
      source: 'OutboundMessageService',
      payload: {
        filename_sanitized: validation.filenameSanitized,
        mime_detected: validation.mimeDetected,
        extension: validation.extension,
        size_bytes: validation.sizeBytes,
        hash: validation.sha256,
        status: 'received',
        reason: null,
        document_id: media.document_id ?? null,
      },
    });
    if (!validation.ok) {
      logger.warn(
        {
          ticket_id: body.ticket_id,
          conversation_id: conversationId,
          correlation_id: correlationId,
          event_type: validation.reason === 'path_traversal_attempt'
            ? 'PATH_TRAVERSAL_ATTEMPT_DETECTED'
            : 'ATTACHMENT_BLOCKED',
          status: 'failed',
          message_type: body.message_type,
          mime_detected: validation.mimeDetected,
          extension: validation.extension,
          size: validation.sizeBytes,
          hash: validation.sha256,
          reason: validation.reason,
        },
        '[integration-service][outbound][ATTACHMENT_BLOCKED]',
      );
      this.recordAudit({
        correlationId,
        ticketId: body.ticket_id,
        conversationId,
        direction: 'outbound',
        eventType: validation.reason === 'mime_extension_mismatch'
          ? 'ATTACHMENT_BLOCKED_DUE_TO_MIME_MISMATCH'
          : validation.reason === 'path_traversal_attempt'
            ? 'PATH_TRAVERSAL_ATTEMPT_DETECTED'
            : 'ATTACHMENT_BLOCKED',
        status: 'failed',
        severity: 'warning',
        source: 'OutboundMessageService',
        errorMessage: validation.reason,
        payload: {
          filename_sanitized: validation.filenameSanitized,
          mime_detected: validation.mimeDetected,
          extension: validation.extension,
          size_bytes: validation.sizeBytes,
          hash: validation.sha256,
          status: 'blocked',
          reason: validation.reason,
          document_id: media.document_id ?? null,
        },
      });

      return {
        httpStatus: 400,
        body: {
          status: 'failed',
          error_code: 'ATTACHMENT_BLOCKED',
          message: 'Attachment blocked by security validation.',
        },
      };
    }

    let messageId: string;
    let metaResponse: unknown;
    let sendMode: 'media' | 'text_fallback' | 'mock' = 'media';
    const safeFilename = validation.filenameSanitized;

    logger.info(
      {
        ticket_id: body.ticket_id,
        conversation_id: conversationId,
        correlation_id: correlationId,
        event_type: 'OUTBOUND_MEDIA_PREPARED',
        status: 'pending',
        message_type: body.message_type,
        mime_type: mimeType,
        filename: safeFilename,
        document_id: media.document_id ?? null,
        size: buffer.byteLength,
      },
      '[integration-service][outbound][OUTBOUND_MEDIA_PREPARED]',
    );

    if (this.outboundSendMode === 'mock') {
      messageId = `mock.wamid.${randomUUID()}`;
      metaResponse = {
        mode: 'mock',
        skipped_meta_api: true,
        message_type: body.message_type,
        filename: safeFilename,
      };
      sendMode = 'mock';
    } else {
      try {
        logger.info(
          {
            ticket_id: body.ticket_id,
            conversation_id: conversationId,
            correlation_id: correlationId,
            event_type: 'OUTBOUND_MEDIA_UPLOAD_STARTED',
            status: 'pending',
            message_type: body.message_type,
            mime_type: mimeType,
            filename: safeFilename,
            document_id: media.document_id ?? null,
          },
          '[integration-service][outbound][OUTBOUND_MEDIA_UPLOAD_STARTED]',
        );
        const uploadedMediaId = await this.metaClient.uploadMedia({
          buffer,
          mimeType: validation.mimeDetected,
          filename: safeFilename,
        });
        if (body.message_type === 'image') {
          metaResponse = await this.metaClient.sendImageMessage({
            to: toForMeta,
            mediaId: uploadedMediaId,
            caption: body.text,
          });
        } else if (body.message_type === 'audio') {
          metaResponse = await this.metaClient.sendAudioMessage({
            to: toForMeta,
            mediaId: uploadedMediaId,
          });
        } else if (body.message_type === 'video') {
          metaResponse = await this.metaClient.sendVideoMessage({
            to: toForMeta,
            mediaId: uploadedMediaId,
            caption: body.text,
          });
        } else {
          metaResponse = await this.metaClient.sendDocumentMessage({
            to: toForMeta,
            mediaId: uploadedMediaId,
            filename: safeFilename,
            caption: body.text,
          });
        }
        messageId = extractMetaMessageId(metaResponse);
      } catch (error: unknown) {
        logger.error(
          {
            ticket_id: body.ticket_id,
            conversation_id: conversationId,
            correlation_id: correlationId,
            event_type: 'OUTBOUND_MEDIA_UPLOAD_FAILED',
            status: 'failed',
            message_type: body.message_type,
            mime_type: mimeType,
            filename: safeFilename,
            document_id: media.document_id ?? null,
            error_message: error instanceof Error ? error.message : String(error),
          },
          '[integration-service][outbound][OUTBOUND_MEDIA_UPLOAD_FAILED]',
        );
        this.recordAudit({
          correlationId,
          ticketId: body.ticket_id,
          conversationId,
          direction: 'outbound',
          eventType: 'ATTACHMENT_FAILED',
          status: 'failed',
          severity: 'error',
          source: 'OutboundMessageService',
          errorMessage: error instanceof Error ? error.message : String(error),
          payload: {
            filename_sanitized: validation.filenameSanitized,
            mime_detected: validation.mimeDetected,
            extension: validation.extension,
            size_bytes: validation.sizeBytes,
            hash: validation.sha256,
            status: 'failed',
            reason: 'meta_upload_failed',
            document_id: media.document_id ?? null,
          },
        });
        metaResponse = await this.metaClient.sendTextMessage({
          to: toForMeta,
          body: fallbackAttachmentText(),
        });
        messageId = extractMetaMessageId(metaResponse);
        sendMode = 'text_fallback';
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
        media: {
          filename: safeFilename,
          mime_type: validation.mimeDetected,
          size: buffer.byteLength,
          document_id: media.document_id ?? null,
        },
      },
      response: metaResponse,
      send_mode: sendMode,
    };

    const inserted = await this.messageRepository.insertOutbound({
      messageId,
      conversationId,
      senderPhone,
      recipientPhone,
      messageType: sendMode === 'text_fallback' ? 'text' : body.message_type,
      messageText: sendMode === 'text_fallback' ? fallbackAttachmentText() : body.text,
      rawPayload,
      mediaInfo: sendMode === 'text_fallback' ? null : {
        direction: 'outbound',
        message_type: body.message_type,
        filename: safeFilename,
        mime_type: validation.mimeDetected,
        size: buffer.byteLength,
        document_id: media.document_id ?? null,
        send_mode: sendMode,
        attachment_status: 'synced',
        attachment_blocked_reason: null,
        attachment_hash: validation.sha256,
        attachment_mime_detected: validation.mimeDetected,
        attachment_extension: validation.extension,
        attachment_size_bytes: validation.sizeBytes,
        attachment_filename_sanitized: validation.filenameSanitized,
      },
      processingStatus: 'sent',
      glpiSyncStatus: 'synced',
      idempotencyKey: normalizedIdempotency,
    });

    if (sendMode !== 'text_fallback') {
      this.recordAudit({
        correlationId,
        ticketId: body.ticket_id,
        conversationId,
        messageId: inserted.messageId,
        direction: 'outbound',
        eventType: 'ATTACHMENT_SYNCED',
        status: 'success',
        severity: 'info',
        source: 'OutboundMessageService',
        payload: {
          filename_sanitized: validation.filenameSanitized,
          mime_detected: validation.mimeDetected,
          extension: validation.extension,
          size_bytes: validation.sizeBytes,
          hash: validation.sha256,
          status: 'synced',
          reason: null,
          document_id: media.document_id ?? null,
        },
      });
    }

    await this.conversationRepository.touch(conversationId, new Date());
    await this.trackInactivityOutbound({
      conversationId,
      ticketId: body.ticket_id,
      idempotencyKey: normalizedIdempotency,
    });

    logger.info(
      {
        ticket_id: body.ticket_id,
        conversation_id: conversationId,
        message_id: inserted.messageId,
        correlation_id: correlationId,
        event_type: 'MESSAGE_SENT',
        status: 'success',
        postgres_message_row_id: inserted.id,
        idempotency_key: normalizedIdempotency,
        outbound_send_mode: this.outboundSendMode,
        send_mode: sendMode,
        message_type: body.message_type,
      },
      '[integration-service][outbound][SEND]',
    );
    logger.info(
      {
        ticket_id: body.ticket_id,
        conversation_id: conversationId,
        message_id: inserted.messageId,
        correlation_id: correlationId,
        event_type: sendMode === 'text_fallback' ? 'OUTBOUND_MEDIA_FALLBACK_SENT' : 'OUTBOUND_MEDIA_SENT',
        status: 'success',
        postgres_message_row_id: inserted.id,
        send_mode: sendMode,
        message_type: body.message_type,
        mime_type: validation.mimeDetected,
        filename: safeFilename,
        document_id: media.document_id ?? null,
      },
      sendMode === 'text_fallback'
        ? '[integration-service][outbound][OUTBOUND_MEDIA_FALLBACK_SENT]'
        : '[integration-service][outbound][OUTBOUND_MEDIA_SENT]',
    );

    return {
      httpStatus: 201,
      body: {
        status: 'sent',
        message_id: inserted.messageId,
        conversation_id: conversationId,
        postgres_message_row_id: inserted.id,
        idempotent: false,
      },
    };
  }

  private recordAudit(input: Parameters<AuditService['recordAuditEventFireAndForget']>[0]): void {
    this.auditService?.recordAuditEventFireAndForget(input);
  }

  private async guardManualTextWindow(input: {
    body: OutboundMessageRequestBody;
    conversationId: string;
    correlationId: string;
  }): Promise<OutboundSendResult | null> {
    const lastInboundAt = await this.findLastInboundAt(input.conversationId);
    const windowOpen = lastInboundAt !== null
      && Date.now() - lastInboundAt.getTime() < WHATSAPP_CUSTOMER_CARE_WINDOW_MS;

    if (windowOpen) {
      return null;
    }

    logger.warn(
      {
        ticket_id: input.body.ticket_id,
        conversation_id: input.conversationId,
        correlation_id: input.correlationId,
        event_type: 'MESSAGE_BLOCKED',
        status: 'failed',
        error_code: MANUAL_WINDOW_CLOSED_ERROR_CODE,
        last_inbound_at: lastInboundAt?.toISOString() ?? null,
      },
      '[integration-service][outbound][WINDOW_24H_CLOSED]',
    );
    this.recordAudit({
      correlationId: input.correlationId,
      ticketId: input.body.ticket_id,
      conversationId: input.conversationId,
      direction: 'outbound',
      eventType: 'MESSAGE_BLOCKED',
      status: 'failed',
      severity: 'warning',
      source: 'OutboundMessageService',
      errorMessage: MANUAL_WINDOW_CLOSED_ERROR_CODE,
      payload: {
        error_code: MANUAL_WINDOW_CLOSED_ERROR_CODE,
        message_type: input.body.message_type,
        last_inbound_at: lastInboundAt?.toISOString() ?? null,
        reason: 'manual_free_text_outside_24h',
      },
    });

    return {
      httpStatus: 409,
      body: {
        status: 'failed',
        error_code: MANUAL_WINDOW_CLOSED_ERROR_CODE,
        message: 'A janela de 24h está fechada. Use um template aprovado para iniciar contato antes de enviar texto livre.',
      },
    };
  }

  private guardManualTemplate(
    body: OutboundMessageRequestBody,
    conversationId: string,
    correlationId: string,
  ): OutboundSendResult | null {
    const templateName = body.template_name?.trim() ?? '';
    const idempotencyKey = body.idempotency_key?.trim() ?? '';
    const controlledManualTemplate = CONTROLLED_MANUAL_TEMPLATE_NAMES.has(templateName)
      && idempotencyKey.startsWith('manual_ticket_template:');

    if (controlledManualTemplate) {
      return null;
    }

    logger.warn(
      {
        ticket_id: body.ticket_id,
        conversation_id: conversationId,
        correlation_id: correlationId,
        event_type: 'MESSAGE_BLOCKED',
        status: 'failed',
        error_code: MANUAL_TEMPLATE_NOT_ALLOWED_ERROR_CODE,
        template_name: templateName,
      },
      '[integration-service][outbound][TEMPLATE_NOT_ALLOWED]',
    );
    this.recordAudit({
      correlationId,
      ticketId: body.ticket_id,
      conversationId,
      direction: 'outbound',
      eventType: 'MESSAGE_BLOCKED',
      status: 'failed',
      severity: 'warning',
      source: 'OutboundMessageService',
      errorMessage: MANUAL_TEMPLATE_NOT_ALLOWED_ERROR_CODE,
      payload: {
        error_code: MANUAL_TEMPLATE_NOT_ALLOWED_ERROR_CODE,
        message_type: body.message_type,
        template_name: templateName,
        reason: 'manual_template_not_controlled',
      },
    });

    return {
      httpStatus: 400,
      body: {
        status: 'failed',
        error_code: MANUAL_TEMPLATE_NOT_ALLOWED_ERROR_CODE,
        message: 'Template não permitido para envio manual. Use um template aprovado e ativo pelo fluxo controlado.',
      },
    };
  }

  private async findLastInboundAt(conversationId: string): Promise<Date | null> {
    const messages = await this.messageRepository.findByConversationId(conversationId, 50);
    const lastInbound = messages.find((message) => message.direction === 'inbound');
    if (!lastInbound) {
      return null;
    }

    const createdAt = lastInbound.createdAt instanceof Date
      ? lastInbound.createdAt
      : new Date(lastInbound.createdAt);

    return Number.isNaN(createdAt.getTime()) ? null : createdAt;
  }

  private async trackInactivityOutbound(input: {
    conversationId: string;
    ticketId: number;
    idempotencyKey: string | null;
  }): Promise<void> {
    if (!this.inactivityTrackingRepository || input.idempotencyKey?.startsWith('inactivity:')) {
      return;
    }

    await this.inactivityTrackingRepository.trackOutboundActivity({
      conversationId: input.conversationId,
      ticketId: input.ticketId,
      occurredAt: new Date(),
    });
  }
}
