import type { KeyLock } from '../contracts/KeyLock.js';
import type { Conversation } from '../entities/Conversation.js';

import type { AuditService } from './AuditService.js';
import type { ConversationRepository } from '../../repositories/contracts/ConversationRepository.js';

const DEFAULT_MINIMUM_INACTIVE_MS = 30 * 60 * 1000;
const SOFT_CLOSE_STATUS = 'cancelled';
const TERMINAL_STATUSES = new Set(['closed', 'cancelled', 'resolved', 'soft_closed']);
const ELIGIBLE_STATUSES = new Set([
  'awaiting_queue_selection',
  'awaiting_entity_selection',
  'collecting_contact_profile',
  'pending_glpi',
  'media_error',
  'open',
  'failed',
  'failed_before_ticket',
]);

export interface ConversationSoftCloseInput {
  conversationId: string;
  reason: string;
  operatorId: number;
  operatorName?: string | null;
  ip?: string | null;
}

export interface ConversationSoftCloseResult {
  status: 'cancelled';
  conversationId: string;
  previousStatus: string;
  newStatus: string;
  idempotent: boolean;
  message: string;
}

interface ConversationSoftCloseOptions {
  minimumInactiveMs?: number;
  now?: () => Date;
}

export class ConversationSoftCloseError extends Error {
  public constructor(
    public readonly statusCode: number,
    public readonly errorCode: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ConversationSoftCloseError';
  }
}

function hasValidTicketId(value: number | null | undefined): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function normalizeReason(value: string): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, 500);
}

function statusOf(conversation: Conversation): string {
  return String(conversation.status || '').trim();
}

function lastCustomerActivityAt(conversation: Conversation): Date | null {
  const lastMessageAt = conversation.lastMessageAt instanceof Date
    ? conversation.lastMessageAt
    : new Date(conversation.lastMessageAt);

  return Number.isNaN(lastMessageAt.getTime()) ? null : lastMessageAt;
}

export class ConversationSoftCloseService {
  private readonly minimumInactiveMs: number;
  private readonly now: () => Date;

  public constructor(
    private readonly conversationRepository: ConversationRepository,
    private readonly keyLock: KeyLock,
    private readonly auditService: AuditService | null = null,
    options: ConversationSoftCloseOptions = {},
  ) {
    this.minimumInactiveMs = options.minimumInactiveMs ?? DEFAULT_MINIMUM_INACTIVE_MS;
    this.now = options.now ?? (() => new Date());
  }

  public async softClose(input: ConversationSoftCloseInput): Promise<ConversationSoftCloseResult> {
    const conversationId = input.conversationId.trim();
    const reason = normalizeReason(input.reason);

    if (conversationId === '') {
      throw new ConversationSoftCloseError(400, 'INVALID_CONVERSATION', 'Conversa inválida.');
    }
    if (input.operatorId <= 0 || !Number.isInteger(input.operatorId)) {
      throw new ConversationSoftCloseError(400, 'INVALID_OPERATOR', 'Operador inválido.');
    }
    if (reason === '') {
      throw new ConversationSoftCloseError(400, 'REASON_REQUIRED', 'Informe o motivo do encerramento administrativo.');
    }

    try {
      return await this.keyLock.withLock(`conversation_soft_close:${conversationId}`, async () => {
        return this.softCloseWithLock({
          ...input,
          conversationId,
          reason,
        });
      });
    } catch (error) {
      if (error instanceof ConversationSoftCloseError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes('lock')) {
        throw new ConversationSoftCloseError(
          409,
          'SOFT_CLOSE_LOCK_BUSY',
          'A conversa está sendo atualizada por outro processo. Tente novamente em instantes.',
        );
      }
      throw error;
    }
  }

  private async softCloseWithLock(input: ConversationSoftCloseInput): Promise<ConversationSoftCloseResult> {
    const conversation = await this.conversationRepository.findById(input.conversationId);
    if (!conversation) {
      throw new ConversationSoftCloseError(404, 'CONVERSATION_NOT_FOUND', 'Conversa não encontrada.');
    }

    const previousStatus = statusOf(conversation);
    if (previousStatus === SOFT_CLOSE_STATUS && !hasValidTicketId(conversation.glpiTicketId)) {
      return {
        status: SOFT_CLOSE_STATUS,
        conversationId: conversation.id,
        previousStatus,
        newStatus: SOFT_CLOSE_STATUS,
        idempotent: true,
        message: 'Conversa já estava encerrada administrativamente.',
      };
    }

    this.assertEligible(conversation);

    if (typeof this.conversationRepository.softCloseAdministrative !== 'function') {
      throw new ConversationSoftCloseError(
        500,
        'SOFT_CLOSE_REPOSITORY_UNAVAILABLE',
        'Repositório de conversa não suporta encerramento administrativo seguro.',
      );
    }

    const updated = await this.conversationRepository.softCloseAdministrative(
      conversation.id,
      previousStatus,
      SOFT_CLOSE_STATUS,
    );

    if (!updated) {
      throw new ConversationSoftCloseError(
        409,
        'CONVERSATION_CHANGED',
        'A conversa mudou durante a operação. Atualize a Central e tente novamente.',
      );
    }

    await this.auditService?.recordAuditEvent({
      conversationId: conversation.id,
      eventType: 'ADMIN_SOFT_CLOSE',
      status: 'success',
      severity: 'warning',
      source: 'integration-service',
      payload: {
        conversation_id: conversation.id,
        operator_id: input.operatorId,
        operator_name: input.operatorName ?? null,
        previous_status: previousStatus,
        new_status: SOFT_CLOSE_STATUS,
        reason: input.reason,
        ip: input.ip ?? null,
        timestamp: this.now().toISOString(),
      },
    });

    return {
      status: SOFT_CLOSE_STATUS,
      conversationId: conversation.id,
      previousStatus,
      newStatus: SOFT_CLOSE_STATUS,
      idempotent: false,
      message: 'Conversa encerrada administrativamente.',
    };
  }

  private assertEligible(conversation: Conversation): void {
    const previousStatus = statusOf(conversation);

    if (hasValidTicketId(conversation.glpiTicketId)) {
      throw new ConversationSoftCloseError(
        409,
        'CONVERSATION_HAS_GLPI_TICKET',
        'Conversa vinculada a ticket GLPI não pode ser encerrada administrativamente por esta ação.',
      );
    }

    if (TERMINAL_STATUSES.has(previousStatus)) {
      throw new ConversationSoftCloseError(
        409,
        'CONVERSATION_ALREADY_TERMINAL',
        'Conversa já está em status terminal.',
        { status: previousStatus },
      );
    }

    if (!ELIGIBLE_STATUSES.has(previousStatus)) {
      throw new ConversationSoftCloseError(
        409,
        'CONVERSATION_STATUS_NOT_ELIGIBLE',
        'Status atual da conversa não permite encerramento administrativo.',
        { status: previousStatus },
      );
    }

    const lastCustomerActivity = lastCustomerActivityAt(conversation);
    const inactiveForMs = lastCustomerActivity === null
      ? Number.NaN
      : this.now().getTime() - lastCustomerActivity.getTime();
    if (!Number.isFinite(inactiveForMs) || inactiveForMs < this.minimumInactiveMs) {
      throw new ConversationSoftCloseError(
        409,
        'CONVERSATION_RECENT_ACTIVITY',
        'Conversa com atividade recente não pode ser encerrada administrativamente.',
        {
          activity_source: 'last_message_at',
          minimum_inactive_seconds: Math.ceil(this.minimumInactiveMs / 1000),
        },
      );
    }
  }
}
