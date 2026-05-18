import type { GlpiClient } from '../../adapters/glpi/GlpiClient.js';
import type { CreateGlpiTicketInput } from '../../adapters/glpi/glpiTypes.js';
import { GlpiRequestError } from '../../errors/GlpiRequestError.js';
import type {
  ConversationRepository,
  EntitySelectionAttempt,
  EntitySelectionAttemptReserveResult,
} from '../../repositories/contracts/ConversationRepository.js';
import type { MessageRepository } from '../../repositories/contracts/MessageRepository.js';
import type { RoutingRepository, RoutingQueueAssignment } from '../../repositories/contracts/RoutingRepository.js';
import type { ContactEntityMemoryRepository } from '../repositories/ContactEntityMemoryRepository.js';
import type { Conversation } from '../entities/Conversation.js';
import type { InboundMessage } from '../entities/InboundMessage.js';
import type { OutboundMessageService } from './OutboundMessageService.js';
import type { CustomerExperienceService } from './CustomerExperienceService.js';
import type { MessageConfigurationService } from './MessageConfigurationService.js';
import { logger } from '../../infra/logger/logger.js';

const DEFAULT_GLPI_TICKET_CREATE_TIMEOUT_MS = 45_000;

export interface ConfirmConversationEntityInput {
  conversationId: string;
  glpiEntityId: number;
  glpiEntityName?: string | null;
  glpiUserId?: number | null;
  createTicket: boolean;
  idempotencyKey?: string | null;
}

export interface ConfirmConversationEntityResult {
  status: 'succeeded' | 'processing';
  conversationId: string;
  glpiTicketId?: number;
  idempotent?: boolean;
  message: string;
  warning?: string;
}

export interface EntitySelectionServiceOptions {
  ticketCreateTimeoutMs?: number;
  processTicketCreationInline?: boolean;
  messageConfigurationService?: Pick<MessageConfigurationService, 'getMessage'> | null;
}

export interface EntitySelectionStatusResult {
  status: EntitySelectionAttempt['status'] | 'not_started' | 'ambiguous_reconciliation';
  conversationId: string;
  glpiTicketId?: number;
  glpiEntityId?: number;
  glpiEntityName?: string | null;
  errorType?: string | null;
  errorMessage?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  durationSeconds?: number | null;
  message: string;
}

export class EntitySelectionError extends Error {
  public constructor(
    public readonly statusCode: number,
    public readonly errorCode: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'EntitySelectionError';
  }
}

export function hasValidGlpiTicketId(value: unknown): value is number | string {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value > 0;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || !/^\d+$/.test(trimmed)) {
      return false;
    }

    return Number.parseInt(trimmed, 10) > 0;
  }

  return false;
}

function cleanTicketText(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim()
    : '';
}

function truncateTicketText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return value.slice(0, Math.max(0, maxLength - 3)).trimEnd() + '...';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readStringDetail(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function readNumberDetail(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function selectConfiguredMessageText(message: Awaited<ReturnType<MessageConfigurationService['getMessage']>> | undefined): string {
  if (!message) {
    return '';
  }

  const custom = message.customText?.trim() ?? '';
  if (custom !== '') {
    return custom;
  }

  const fallback = message.fallbackText?.trim() ?? '';
  if (message.defaultText.trim() === '' && fallback !== '') {
    return fallback;
  }

  return message.defaultText;
}

function describeTicketCreationFailure(error: unknown): {
  persistedMessage: string;
  publicMessage: string;
  details: Record<string, unknown>;
} {
  if (error instanceof GlpiRequestError) {
    const responseBody = isRecord(error.responseBody) ? error.responseBody : {};
    const errorType = readStringDetail(responseBody, 'error_type');
    const timeoutMs = readNumberDetail(responseBody, 'timeout_ms');
    const details: Record<string, unknown> = {
      glpi_stage: error.stage ?? null,
      glpi_status_code: error.statusCode ?? null,
      glpi_request_url: error.requestUrl ?? null,
      error_type: errorType ?? (error.statusCode === 401 || error.statusCode === 403 ? 'auth' : 'glpi_api'),
      timeout_ms: timeoutMs,
    };

    if (error.stage === 'glpi_init_session' && errorType === 'timeout') {
      return {
        persistedMessage: 'glpi_init_session timeout before ticket creation',
        publicMessage: 'Falha ao iniciar sessão no GLPI por timeout. Nenhum ticket foi criado. Tente novamente.',
        details,
      };
    }

    if (error.stage === 'glpi_ticket_create' && errorType === 'timeout') {
      return {
        persistedMessage: 'glpi_ticket_create timeout; reconciliation pending',
        publicMessage: 'O GLPI demorou para responder após a solicitação. Atualize a Central em alguns segundos antes de tentar novamente.',
        details,
      };
    }

    if (error.statusCode === 401 || error.statusCode === 403) {
      return {
        persistedMessage: `glpi_auth_failed before ticket creation at ${error.stage ?? 'unknown_stage'}`,
        publicMessage: 'Falha de autenticação na API do GLPI. Nenhum ticket foi criado. Acione revisão operacional.',
        details: {...details, error_type: 'auth'},
      };
    }

    return {
      persistedMessage: `glpi_request_failed before ticket creation at ${error.stage ?? 'unknown_stage'}`,
      publicMessage: 'Falha na API do GLPI ao criar o chamado. Nenhum ticket foi criado. Tente novamente.',
      details,
    };
  }

  const message = error instanceof Error ? error.message : 'Falha desconhecida ao criar chamado.';
  return {
    persistedMessage: message,
    publicMessage: 'Falha ao criar o chamado. Nenhum ticket foi vinculado. Tente novamente.',
    details: {error_type: 'unknown'},
  };
}

function isGlpiTicketCreateTimeout(error: unknown): boolean {
  if (!(error instanceof GlpiRequestError) || error.stage !== 'glpi_ticket_create') {
    return false;
  }

  const responseBody = isRecord(error.responseBody) ? error.responseBody : {};
  return readStringDetail(responseBody, 'error_type') === 'timeout';
}

export class EntitySelectionService {
  public constructor(
    private readonly conversationRepository: ConversationRepository,
    private readonly messageRepository: MessageRepository,
    private readonly routingRepository: RoutingRepository,
    private readonly glpiClient: GlpiClient,
    private readonly contactEntityMemoryRepository: ContactEntityMemoryRepository,
    private readonly outboundMessageService: Pick<OutboundMessageService, 'send'> | null = null,
    private readonly customerExperienceService: Pick<CustomerExperienceService, 'resolveGlpiRequester'> | null = null,
    options: EntitySelectionServiceOptions = {},
  ) {
    this.ticketCreateTimeoutMs = Number.isInteger(options.ticketCreateTimeoutMs) && options.ticketCreateTimeoutMs! > 0
      ? options.ticketCreateTimeoutMs!
      : DEFAULT_GLPI_TICKET_CREATE_TIMEOUT_MS;
    this.processTicketCreationInline = options.processTicketCreationInline === true;
    this.messageConfigurationService = options.messageConfigurationService ?? null;
  }

  private readonly ticketCreateTimeoutMs: number;
  private readonly processTicketCreationInline: boolean;
  private readonly messageConfigurationService: Pick<MessageConfigurationService, 'getMessage'> | null;

  public createGlpiTicket(input: CreateGlpiTicketInput, options?: Parameters<GlpiClient['createTicket']>[1]) {
    return this.glpiClient.createTicket(input, options);
  }

  public reserveEntitySelectionAttempt(
    conversationId: string,
    glpiEntityId: number,
    glpiEntityName?: string | null,
    idempotencyKey?: string | null,
  ): Promise<EntitySelectionAttemptReserveResult> {
    const resolvedIdempotencyKey = this.resolveEntitySelectionIdempotencyKey(
      conversationId,
      glpiEntityId,
      idempotencyKey,
    );
    return this.conversationRepository.reserveEntitySelectionAttempt(
      conversationId,
      glpiEntityId,
      glpiEntityName,
      resolvedIdempotencyKey,
    );
  }

  public findEntitySelectionAttemptByConversationId(conversationId: string) {
    return this.conversationRepository.findEntitySelectionAttemptByConversationId(conversationId);
  }

  public findByConversationId(conversationId: string, limit?: number): Promise<InboundMessage[]> {
    return this.messageRepository.findByConversationId(conversationId, limit);
  }

  public findAssignmentByQueueId(queueId: number): Promise<RoutingQueueAssignment | null> {
    return this.routingRepository.findAssignmentByQueueId(queueId);
  }

  public async getEntitySelectionStatus(conversationId: string): Promise<EntitySelectionStatusResult> {
    const normalizedConversationId = conversationId.trim();
    if (!normalizedConversationId) {
      throw new EntitySelectionError(400, 'CONVERSATION_ID_REQUIRED', 'conversation_id obrigatório.');
    }

    const conversation = await this.conversationRepository.findById(normalizedConversationId);
    if (!conversation) {
      throw new EntitySelectionError(404, 'CONVERSATION_NOT_FOUND', 'Conversa não encontrada.');
    }

    const attempt = await this.conversationRepository.findEntitySelectionAttemptByConversationId(
      normalizedConversationId,
    );
    if (attempt) {
      return this.buildEntitySelectionStatusResult(attempt);
    }

    if (hasValidGlpiTicketId(conversation.glpiTicketId)) {
      return {
        status: 'succeeded',
        conversationId: conversation.id,
        glpiTicketId: Number(conversation.glpiTicketId),
        glpiEntityId: typeof conversation.glpiEntityId === 'number' ? conversation.glpiEntityId : undefined,
        glpiEntityName: conversation.glpiEntityName ?? null,
        errorType: null,
        errorMessage: null,
        startedAt: null,
        finishedAt: null,
        durationSeconds: null,
        message: `A conversa já foi vinculada ao chamado #${conversation.glpiTicketId}.`,
      };
    }

    return {
      status: 'not_started',
      conversationId: conversation.id,
      errorType: null,
      errorMessage: null,
      startedAt: null,
      finishedAt: null,
      durationSeconds: null,
      message: 'Nenhuma tentativa de criação de chamado foi iniciada.',
    };
  }

  public async confirmEntity(input: ConfirmConversationEntityInput): Promise<ConfirmConversationEntityResult> {
    if (!Number.isInteger(input.glpiEntityId) || input.glpiEntityId <= 0) {
      throw new EntitySelectionError(400, 'INVALID_ENTITY', 'Entidade GLPI inválida.');
    }

    const conversation = await this.conversationRepository.findById(input.conversationId);
    if (!conversation) {
      throw new EntitySelectionError(404, 'CONVERSATION_NOT_FOUND', 'Conversa não encontrada.');
    }

    if (hasValidGlpiTicketId(conversation.glpiTicketId)) {
      return {
        status: 'succeeded',
        conversationId: conversation.id,
        glpiTicketId: Number(conversation.glpiTicketId),
        idempotent: true,
        message: `A conversa já foi vinculada ao chamado #${conversation.glpiTicketId}.`,
      };
    }

    const existingAttempt = await this.conversationRepository.findEntitySelectionAttemptByConversationId(
      conversation.id,
    );
    const existingResult = this.resultForExistingAttempt(existingAttempt);
    if (existingResult) {
      return existingResult;
    }

    if (!input.createTicket) {
      throw new EntitySelectionError(
        409,
        'TICKET_REQUIRED',
        'A conversa está aguardando entidade e ainda não possui chamado válido.',
      );
    }

    if (!this.canConfirmEntityForConversation(conversation)) {
      throw new EntitySelectionError(
        409,
        'CONVERSATION_STATUS_NOT_ALLOWED',
        'A conversa não está aguardando definição de entidade.',
        { status: conversation.status },
      );
    }

    if (hasValidGlpiTicketId(conversation.glpiTicketId)) {
      return {
        status: 'succeeded',
        conversationId: conversation.id,
        glpiTicketId: Number(conversation.glpiTicketId),
        idempotent: true,
        message: `A conversa já foi vinculada ao chamado #${conversation.glpiTicketId}.`,
      };
    }

    if (existingAttempt?.status === 'failed_before_ticket' && this.processTicketCreationInline) {
      if (typeof existingAttempt.errorMessage === 'string'
        && existingAttempt.errorMessage.startsWith('ambiguous_reconciliation:')) {
        throw new EntitySelectionError(
          409,
          'AMBIGUOUS_RECONCILIATION',
          'A criação pode ter sido concluída no GLPI, mas há múltiplos chamados candidatos. Acione revisão humana antes de tentar novamente.',
        );
      }

      const reconciled = await this.tryReconcileEntitySelectionTicket(
        conversation,
        input,
        existingAttempt,
        'retry_after_failed_before_ticket',
      );
      if (reconciled) {
        return reconciled;
      }
    }

    const { attempt } = await this.conversationRepository.reserveEntitySelectionAttempt(
      conversation.id,
      input.glpiEntityId,
      input.glpiEntityName ?? null,
      this.resolveEntitySelectionIdempotencyKey(
        conversation.id,
        input.glpiEntityId,
        input.idempotencyKey,
      ),
    );
    if (attempt.status !== 'processing') {
      const attemptResult = this.resultForExistingAttempt(attempt);
      if (attemptResult) {
        return attemptResult;
      }
    }

    if (this.processTicketCreationInline) {
      return this.createTicketForEntitySelection(conversation, input, attempt);
    }

    this.startEntitySelectionProcessing(conversation, input, attempt);
    return {
      status: 'processing',
      conversationId: conversation.id,
      idempotent: false,
      message: 'Criação do chamado iniciada. Acompanhe o status na Central.',
    };
  }

  private canConfirmEntityForConversation(conversation: Conversation): boolean {
    if (conversation.status === 'awaiting_entity_selection') {
      return true;
    }

    if (conversation.status !== 'collecting_contact_profile' || hasValidGlpiTicketId(conversation.glpiTicketId)) {
      return false;
    }

    const state = isRecord(conversation.profileCollectionState ?? null)
      ? conversation.profileCollectionState as Record<string, unknown>
      : {};

    return state.step === 'complete';
  }

  private resultForExistingAttempt(attempt: EntitySelectionAttempt | null): ConfirmConversationEntityResult | null {
    if (!attempt) {
      return null;
    }

    if (attempt.status === 'processing') {
      return {
        status: 'processing',
        conversationId: attempt.conversationId,
        glpiTicketId: attempt.glpiTicketId ?? undefined,
        idempotent: true,
        message: 'A criação do chamado ainda está em processamento. Atualize a Central em alguns segundos.',
      };
    }

    if (attempt.status === 'succeeded' && hasValidGlpiTicketId(attempt.glpiTicketId)) {
      return {
        status: 'succeeded',
        conversationId: attempt.conversationId,
        glpiTicketId: Number(attempt.glpiTicketId),
        idempotent: true,
        message: `A conversa já foi vinculada ao chamado #${attempt.glpiTicketId}.`,
      };
    }

    if (attempt.status === 'failed_after_ticket') {
      throw new EntitySelectionError(
        409,
        'FAILED_AFTER_TICKET',
        'Um ticket foi criado no GLPI, mas não foi possível vincular a conversa. Acione revisão operacional.',
        { glpiTicketId: attempt.glpiTicketId },
      );
    }

    if (
      attempt.status === 'failed_before_ticket'
      && typeof attempt.errorMessage === 'string'
      && attempt.errorMessage.startsWith('ambiguous_reconciliation:')
    ) {
      throw new EntitySelectionError(
        409,
        'AMBIGUOUS_RECONCILIATION',
        'A criação pode ter sido concluída no GLPI, mas há múltiplos chamados candidatos. Acione revisão humana antes de tentar novamente.',
      );
    }

    return null;
  }

  private startEntitySelectionProcessing(
    conversation: Conversation,
    input: ConfirmConversationEntityInput,
    attempt: EntitySelectionAttempt,
  ): void {
    void this.createTicketForEntitySelection(conversation, input, attempt).catch((error: unknown) => {
      logger.warn(
        {
          conversation_id: conversation.id,
          attempt_id: attempt.id,
          glpi_entity_id: input.glpiEntityId,
          error_code: error instanceof EntitySelectionError ? error.errorCode : undefined,
          error_message: error instanceof Error ? error.message : String(error),
        },
        '[integration-service][entity_selection][BACKGROUND_FINISHED_WITH_ERROR]',
      );
    });
  }

  private buildEntitySelectionStatusResult(attempt: EntitySelectionAttempt): EntitySelectionStatusResult {
    const ambiguous = attempt.status === 'failed_before_ticket'
      && typeof attempt.errorMessage === 'string'
      && attempt.errorMessage.startsWith('ambiguous_reconciliation:');
    const status = ambiguous ? 'ambiguous_reconciliation' : attempt.status;
    const startedAt = attempt.createdAt instanceof Date && !Number.isNaN(attempt.createdAt.getTime())
      ? attempt.createdAt.toISOString()
      : null;
    const finishedAt = attempt.finishedAt instanceof Date && !Number.isNaN(attempt.finishedAt.getTime())
      ? attempt.finishedAt.toISOString()
      : null;
    const durationSeconds = finishedAt && startedAt
      ? Math.max(0, Math.round((attempt.finishedAt!.getTime() - attempt.createdAt.getTime()) / 1000))
      : null;

    return {
      status,
      conversationId: attempt.conversationId,
      glpiTicketId: attempt.glpiTicketId ?? undefined,
      glpiEntityId: attempt.glpiEntityId ?? undefined,
      glpiEntityName: attempt.glpiEntityName ?? null,
      errorType: this.inferAttemptErrorType(attempt),
      errorMessage: this.publicAttemptMessage(attempt, status),
      startedAt,
      finishedAt,
      durationSeconds,
      message: this.publicAttemptMessage(attempt, status),
    };
  }

  private inferAttemptErrorType(attempt: EntitySelectionAttempt): string | null {
    if (!attempt.errorMessage) {
      return null;
    }
    if (attempt.errorMessage.includes('timeout') || attempt.errorMessage.includes('aborted')) {
      return 'timeout';
    }
    if (attempt.errorMessage.startsWith('ambiguous_reconciliation:')) {
      return 'ambiguous_reconciliation';
    }
    if (attempt.status === 'failed_after_ticket') {
      return 'failed_after_ticket';
    }
    if (attempt.status === 'failed_before_ticket') {
      return 'failed_before_ticket';
    }
    return 'error';
  }

  private publicAttemptMessage(
    attempt: EntitySelectionAttempt,
    status: EntitySelectionStatusResult['status'],
  ): string {
    if (status === 'processing') {
      return 'Criando chamado no GLPI...';
    }
    if (status === 'succeeded' && hasValidGlpiTicketId(attempt.glpiTicketId)) {
      return `Chamado #${attempt.glpiTicketId} criado ou reconciliado com sucesso.`;
    }
    if (status === 'ambiguous_reconciliation') {
      return 'Há múltiplos chamados candidatos no GLPI. Exige decisão humana antes de nova tentativa.';
    }
    if (status === 'failed_after_ticket') {
      return 'Um ticket foi criado no GLPI, mas não foi possível vincular a conversa. Acione revisão operacional.';
    }
    if (status === 'failed_before_ticket' && attempt.errorMessage?.includes('glpi_ticket_create timeout')) {
      return 'A criação pode ter sido concluída no GLPI. Aguarde a reconciliação antes de tentar novamente.';
    }
    if (status === 'failed_before_ticket') {
      return 'Falha antes de confirmar a criação do chamado no GLPI.';
    }
    if (status === 'cancelled') {
      return 'Tentativa cancelada.';
    }
    return 'Status da tentativa disponível.';
  }

  private resolveEntitySelectionIdempotencyKey(
    conversationId: string,
    glpiEntityId: number,
    providedKey?: string | null,
  ): string {
    const fallback = `entity_selection:${conversationId}:${glpiEntityId}`;
    const normalized = typeof providedKey === 'string' ? providedKey.trim() : '';
    if (normalized === '') {
      return fallback;
    }

    if (!/^[a-zA-Z0-9:._-]{1,180}$/.test(normalized)) {
      return fallback;
    }

    return normalized;
  }

  private async createTicketForEntitySelection(
    conversation: Conversation,
    input: ConfirmConversationEntityInput,
    attempt: EntitySelectionAttempt,
  ): Promise<ConfirmConversationEntityResult> {
    let ticketId: number | null = null;
    try {
      if (attempt.status === 'failed_before_ticket') {
        const preCreateReconciled = await this.tryReconcileEntitySelectionTicket(
          conversation,
          input,
          attempt,
          'before_ticket_create',
        );
        if (preCreateReconciled) {
          return preCreateReconciled;
        }
      }

      const messages = await this.messageRepository.findByConversationId(conversation.id, 50);
      const assignment = conversation.queueId
        ? await this.routingRepository.findAssignmentByQueueId(conversation.queueId)
        : null;
      const requesterUser = await this.resolveRequesterUser(conversation, input.glpiEntityId);
      const createdTicketId = await this.glpiClient.createTicket(
        this.buildTicketInput(
          conversation,
          input,
          messages,
          assignment,
          requesterUser,
          this.buildEntitySelectionCorrelationMarker(attempt),
        ),
        { timeoutMs: this.ticketCreateTimeoutMs },
      );
      ticketId = createdTicketId;

      const glpiEntityName = await this.resolveEntityNameForMemory(conversation, input);
      const linked = await this.conversationRepository.linkGlpiTicket(
        conversation.id,
        createdTicketId,
        conversation.queueId,
        input.glpiEntityId,
        glpiEntityName,
      );
      if (!linked) {
        await this.conversationRepository.markEntitySelectionAttemptFailedAfterTicket(
          attempt.id,
          createdTicketId,
          'Falha ao vincular ticket criado à conversa.',
        );
        throw new EntitySelectionError(
          500,
          'FAILED_AFTER_TICKET',
          'Um ticket foi criado no GLPI, mas não foi possível vincular a conversa. Acione revisão operacional.',
          { glpiTicketId: createdTicketId },
        );
      }

      await this.contactEntityMemoryRepository.rememberEntityForPhone({
        phoneE164: conversation.phoneE164,
        contactId: conversation.contactId,
        glpiEntityId: input.glpiEntityId,
        glpiEntityName,
        sourceTicketId: createdTicketId,
        sourceConversationId: conversation.id,
        source: 'manual',
      });
      await this.conversationRepository.markEntitySelectionAttemptSucceeded(attempt.id, createdTicketId);
      this.enqueueTicketCreatedNotification(conversation, createdTicketId, input);

      return {
        status: 'succeeded',
        conversationId: conversation.id,
        glpiTicketId: createdTicketId,
        message: `Chamado #${createdTicketId} criado e vinculado com sucesso.`,
      };
    } catch (error) {
      if (error instanceof EntitySelectionError) {
        throw error;
      }

      const failure = describeTicketCreationFailure(error);
      if (isGlpiTicketCreateTimeout(error)) {
        const reconciled = await this.tryReconcileEntitySelectionTicket(
          conversation,
          input,
          attempt,
          'ticket_create_timeout',
        );
        if (reconciled) {
          return reconciled;
        }
      }

      if (ticketId && ticketId > 0) {
        await this.conversationRepository.markEntitySelectionAttemptFailedAfterTicket(
          attempt.id,
          ticketId,
          failure.persistedMessage,
        );
        throw new EntitySelectionError(
          500,
          'FAILED_AFTER_TICKET',
          'Um ticket foi criado no GLPI, mas não foi possível vincular a conversa. Acione revisão operacional.',
          { glpiTicketId: ticketId },
        );
      }

      await this.conversationRepository.markEntitySelectionAttemptFailedBeforeTicket(
        attempt.id,
        failure.persistedMessage,
      );
      throw new EntitySelectionError(
        502,
        'FAILED_BEFORE_TICKET',
        failure.publicMessage,
        failure.details,
      );
    }
  }

  private buildEntitySelectionCorrelationMarker(attempt: EntitySelectionAttempt): string {
    const candidate = typeof attempt.idempotencyKey === 'string' && attempt.idempotencyKey.trim() !== ''
      ? attempt.idempotencyKey.trim()
      : `entity_selection:${attempt.conversationId}:${attempt.glpiEntityId ?? 'unknown'}`;

    return `[IntegraGLPI correlation_id: ${candidate}]`;
  }

  private async tryReconcileEntitySelectionTicket(
    conversation: Conversation,
    input: ConfirmConversationEntityInput,
    attempt: EntitySelectionAttempt,
    reason: string,
  ): Promise<ConfirmConversationEntityResult | null> {
    const entityId = attempt.glpiEntityId && attempt.glpiEntityId > 0
      ? attempt.glpiEntityId
      : input.glpiEntityId;
    if (!Number.isInteger(entityId) || entityId <= 0) {
      return null;
    }

    const marker = this.buildEntitySelectionCorrelationMarker(attempt);
    const tickets = await this.glpiClient.findTicketsForEntitySelection({
      correlationMarker: marker,
      requesterPhone: conversation.phoneE164,
      entitiesId: entityId,
    });
    if (tickets.length === 0) {
      return null;
    }

    if (tickets.length > 1) {
      const candidateIds = tickets
        .filter((ticket) => hasValidGlpiTicketId(ticket.id))
        .map((ticket) => Number(ticket.id))
        .slice(0, 5);
      await this.conversationRepository.markEntitySelectionAttemptFailedBeforeTicket(
        attempt.id,
        `ambiguous_reconciliation: ${candidateIds.join(',')}`,
      );
      throw new EntitySelectionError(
        409,
        'AMBIGUOUS_RECONCILIATION',
        'A criação pode ter sido concluída no GLPI, mas há múltiplos chamados candidatos. Acione revisão humana antes de tentar novamente.',
        {
          candidate_count: tickets.length,
          candidate_ticket_ids: candidateIds,
        },
      );
    }

    const ticket = tickets[0];
    if (!ticket || !hasValidGlpiTicketId(ticket.id)) {
      return null;
    }

    const glpiEntityName = await this.resolveEntityNameForMemory(conversation, {
      ...input,
      glpiEntityId: entityId,
      glpiEntityName: attempt.glpiEntityName ?? input.glpiEntityName ?? null,
    });
    const linked = await this.conversationRepository.linkGlpiTicket(
      conversation.id,
      ticket.id,
      conversation.queueId,
      entityId,
      glpiEntityName,
    );
    if (!linked) {
      await this.conversationRepository.markEntitySelectionAttemptFailedAfterTicket(
        attempt.id,
        ticket.id,
        'Ticket reconciliado no GLPI, mas falha ao vincular conversa.',
      );
      throw new EntitySelectionError(
        500,
        'FAILED_AFTER_TICKET',
        'Um ticket foi localizado no GLPI, mas não foi possível vincular a conversa. Acione revisão operacional.',
        { glpiTicketId: ticket.id },
      );
    }

    await this.contactEntityMemoryRepository.rememberEntityForPhone({
      phoneE164: conversation.phoneE164,
      contactId: conversation.contactId,
      glpiEntityId: entityId,
      glpiEntityName,
      sourceTicketId: ticket.id,
      sourceConversationId: conversation.id,
      source: 'manual',
    });
    await this.conversationRepository.markEntitySelectionAttemptSucceeded(attempt.id, ticket.id);
    this.enqueueTicketCreatedNotification(conversation, ticket.id, input);

    logger.info(
      {
        conversation_id: conversation.id,
        ticket_id: ticket.id,
        glpi_entity_id: entityId,
        reason,
      },
      '[integration-service][entity_selection][TICKET_RECONCILED]',
    );

    return {
      status: 'succeeded',
      conversationId: conversation.id,
      glpiTicketId: ticket.id,
      idempotent: true,
      message: `Chamado #${ticket.id} localizado no GLPI e vinculado com sucesso.`,
      warning: 'A criação anterior pode ter concluído no GLPI após timeout; nenhum novo chamado foi criado.',
    };
  }

  private enqueueTicketCreatedNotification(
    conversation: Conversation,
    ticketId: number,
    input: ConfirmConversationEntityInput,
  ): void {
    if (!this.outboundMessageService) {
      return;
    }

    void this.notifyTicketCreated(conversation, ticketId, input).catch((error: unknown) => {
      logger.warn(
        {
          conversation_id: conversation.id,
          ticket_id: ticketId,
          error_message: error instanceof Error ? error.message : String(error),
        },
        '[integration-service][entity_selection][TICKET_CREATED_NOTIFICATION_FAILED]',
      );
    });
  }

  private async resolveEntityNameForMemory(
    conversation: Conversation,
    input: ConfirmConversationEntityInput,
  ): Promise<string | null> {
    const selectedName = typeof input.glpiEntityName === 'string' ? input.glpiEntityName.trim() : '';
    if (selectedName !== '') {
      return selectedName;
    }

    const activeMemory = await this.contactEntityMemoryRepository.findActiveByPhone(conversation.phoneE164);
    if (
      activeMemory
      && activeMemory.glpiEntityId === input.glpiEntityId
      && typeof activeMemory.glpiEntityName === 'string'
      && activeMemory.glpiEntityName.trim() !== ''
    ) {
      return activeMemory.glpiEntityName.trim();
    }

    return null;
  }

  private async notifyTicketCreated(
    conversation: Conversation,
    ticketId: number,
    input: ConfirmConversationEntityInput,
  ): Promise<void> {
    const message = await this.messageConfigurationService?.getMessage('ticket_created_message');
    const configuredText = selectConfiguredMessageText(message)
      .replace(/\{\{ticket_id\}\}/g, String(ticketId))
      .replace(/\{ticket_id\}/g, String(ticketId))
      .replace(/#\{ticket_id\}/g, `#${ticketId}`)
      .trim();

    const result = await this.outboundMessageService!.send({
      ticket_id: ticketId,
      conversation_id: conversation.id,
      text: configuredText !== '' ? configuredText : `Seu chamado #${ticketId} foi aberto.`,
      message_type: 'text',
      glpi_user_id: input.glpiUserId ?? 0,
      idempotency_key: `ticket_created_entity_selection:${conversation.id}:${ticketId}`,
    });

    if (result.httpStatus >= 400 || result.body.status !== 'sent') {
      throw new Error('Ticket created WhatsApp notification was not sent.');
    }
  }

  private buildTicketInput(
    conversation: Conversation,
    input: ConfirmConversationEntityInput,
    messages: InboundMessage[],
    assignment: RoutingQueueAssignment | null,
    requesterUserId: number | null,
    correlationMarker: string,
  ): CreateGlpiTicketInput {
    const profileState = isRecord(conversation.profileCollectionState ?? null)
      ? conversation.profileCollectionState as Record<string, unknown>
      : {};
    const queueLabel = cleanTicketText(profileState.queue_label)
      || (conversation.queueId ? `Fila ${conversation.queueId}` : 'WhatsApp');
    const company = cleanTicketText(profileState.company_name_raw);
    const requesterName = cleanTicketText(profileState.requester_name);
    const reasonFromState = cleanTicketText(profileState.reason);
    const latestInboundText = messages
      .filter((message) => message.direction === 'inbound')
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]?.messageText;
    const shortReason = truncateTicketText(reasonFromState || cleanTicketText(latestInboundText) || 'Atendimento', 60);
    const titleIdentity = company || requesterName || conversation.phoneE164;
    const titleParts = [titleIdentity];
    if (requesterName && requesterName !== titleIdentity) {
      titleParts.push(requesterName);
    }
    titleParts.push(shortReason);
    const messageLines = messages
      .slice()
      .reverse()
      .map((message) => {
        const body = message.messageText?.trim() || `[${message.messageType}]`;
        return `[${message.createdAt.toISOString()}] ${message.direction}: ${body}`;
      });

    const content = [
      'Atendimento WhatsApp recebido antes da definicao de entidade.',
      '',
      ...messageLines,
      '',
      '---',
      `Telefone (WhatsApp): ${conversation.phoneE164}`,
      `Empresa informada: ${company || '(n/d)'}`,
      `Nome informado: ${requesterName || '(n/d)'}`,
      `E-mail informado: ${cleanTicketText(profileState.email_address) || '(não informado)'}`,
      `Motivo informado: ${reasonFromState || '(n/d)'}`,
      `Entidade selecionada: ${input.glpiEntityName ?? input.glpiEntityId}`,
      '',
      correlationMarker,
    ].join('\n');

    return {
      title: truncateTicketText(`[WA][${queueLabel}] ${titleParts.join(' — ')}`, 200),
      content,
      requesterPhone: conversation.phoneE164,
      requesterName: null,
      entitiesId: input.glpiEntityId,
      assignedGroupId: assignment?.glpiGroupId ?? undefined,
      assignedUserId: input.glpiUserId ?? assignment?.glpiUserId ?? undefined,
      requesterUserId,
    };
  }

  private async resolveRequesterUser(conversation: Conversation, glpiEntityId: number): Promise<number | null> {
    if (!this.customerExperienceService) {
      return null;
    }

    const profileState = isRecord(conversation.profileCollectionState ?? null)
      ? conversation.profileCollectionState as Record<string, unknown>
      : {};
    const profile = {
      phone_e164: conversation.phoneE164,
      requester_name: cleanTicketText(profileState.requester_name) || null,
      email_address: cleanTicketText(profileState.email_address) || null,
      email_status: this.readEmailStatus(profileState.email_status),
      company_name_raw: cleanTicketText(profileState.company_name_raw) || null,
      last_equipment_tag: cleanTicketText(profileState.last_equipment_tag) || null,
      equipment_tag_unknown: profileState.equipment_tag_unknown === true,
      last_problem_summary: cleanTicketText(profileState.reason) || null,
      profile_status: 'complete' as const,
      profile_source: 'whatsapp' as const,
      confirmation_count: 1,
      last_confirmed_at: new Date().toISOString(),
      last_conversation_id: conversation.id,
    };

    const result = await this.customerExperienceService.resolveGlpiRequester({
      phoneE164: conversation.phoneE164,
      profile,
      entitiesId: glpiEntityId,
      conversationId: conversation.id,
    });

    return result.glpiUserId;
  }

  private readEmailStatus(value: unknown): 'valid' | 'invalid' | 'not_provided' | undefined {
    return value === 'valid' || value === 'invalid' || value === 'not_provided' ? value : undefined;
  }
}
