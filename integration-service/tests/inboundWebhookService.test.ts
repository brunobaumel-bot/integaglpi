import { describe, expect, it, vi } from 'vitest';

import type { Contact } from '../src/domain/entities/Contact.js';
import type { Conversation } from '../src/domain/entities/Conversation.js';
import type { InboundMessage } from '../src/domain/entities/InboundMessage.js';
import type { WebhookEvent } from '../src/domain/entities/WebhookEvent.js';
import type { ConversationRepository, CreateConversationInput, EntitySelectionAttempt, EntitySelectionAttemptReserveResult } from '../src/repositories/contracts/ConversationRepository.js';
import type {
  MessageRepository,
  ReserveInboundMessageInput,
  UpdateMessageStateInput,
  InsertedOutboundMessage,
  RecordDeliveryStatusInput,
  RecordDeliveryStatusResult,
} from '../src/repositories/contracts/MessageRepository.js';
import type { WebhookEventRepository, CreateWebhookEventInput } from '../src/repositories/contracts/WebhookEventRepository.js';
import type { ActiveRoutingOption, RoutingRepository, RoutingQueueAssignment } from '../src/repositories/contracts/RoutingRepository.js';
import type {
  ReserveSolutionActionInput,
  ReserveSolutionActionResult,
  SolutionAction,
  SolutionActionRepository,
} from '../src/repositories/contracts/SolutionActionRepository.js';
import { InboundWebhookService } from '../src/domain/services/InboundWebhookService.js';
import type { AuditService } from '../src/domain/services/AuditService.js';
import type { KeyLock } from '../src/domain/contracts/KeyLock.js';
import type { MessageSettingKey } from '../src/domain/services/SettingsService.js';
import type { ContactEntityMemory } from '../src/domain/repositories/ContactEntityMemoryRepository.js';
import type { ContactProfileData } from '../src/domain/services/ContactProfileService.js';
import { logger } from '../src/infra/logger/logger.js';

class FakeKeyLock implements KeyLock {
  public async withLock<T>(_key: string, work: () => Promise<T>): Promise<T> {
    return await work();
  }
}

class FakeWebhookEventRepository implements WebhookEventRepository {
  public created: CreateWebhookEventInput[] = [];
  public updates: Array<{ eventId: string; processingStatus: string }> = [];

  public async create(input: CreateWebhookEventInput): Promise<WebhookEvent> {
    this.created.push(input);
    return {
      eventId: input.eventId,
      eventType: input.eventType,
      payload: input.payload,
      signatureValid: input.signatureValid,
      receivedAt: new Date(),
      processingStatus: input.processingStatus,
      createdAt: new Date(),
    };
  }

  public async updateStatus(eventId: string, processingStatus: string): Promise<void> {
    this.updates.push({ eventId, processingStatus });
  }
}

class FakeMessageRepository implements MessageRepository {
  public reservedMessage: InboundMessage | null = {
    id: 'message-row-1',
    conversationId: null,
    messageId: 'wamid.123',
    direction: 'inbound',
    senderPhone: '+5511999999999',
    recipientPhone: '+5511300000000',
    messageType: 'text',
    messageText: 'hello',
    rawPayload: {},
    mediaInfo: null,
    processingStatus: 'processing',
    glpiSyncStatus: 'not_sent',
    metaMessageId: null,
    deliveryStatus: null,
    deliveryStatusUpdatedAt: null,
    metaErrorCode: null,
    metaErrorMessageSanitized: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  public updates: UpdateMessageStateInput[] = [];
  public mediaInfoUpdates: Array<{ messageId: string; mediaInfo: Record<string, unknown> }> = [];
  public reservedInputs: ReserveInboundMessageInput[] = [];
  public deliveryStatusInputs: RecordDeliveryStatusInput[] = [];
  public deliveryStatusResult: RecordDeliveryStatusResult | null = null;
  public messagesById = new Map<string, InboundMessage>();

  public async reserveInbound(input: ReserveInboundMessageInput): Promise<InboundMessage | null> {
    this.reservedInputs.push(input);

    if (!this.reservedMessage) {
      return null;
    }

    return {
      ...this.reservedMessage,
      messageId: input.messageId,
      senderPhone: input.senderPhone,
      recipientPhone: input.recipientPhone,
      messageText: input.messageText,
      rawPayload: input.rawPayload,
    };
  }

  public async findByMessageId(messageId: string): Promise<InboundMessage | null> {
    return this.messagesById.get(messageId) ?? null;
  }

  public async findByIdempotencyKey(): Promise<InboundMessage | null> {
    return null;
  }

  public async findByConversationId(_conversationId: string, _limit?: number): Promise<InboundMessage[]> {
    return [];
  }

  public async insertOutbound(): Promise<InsertedOutboundMessage> {
    return { id: 'outbound-row-1', messageId: 'wamid.outbound' };
  }

  public async recordDeliveryStatus(input: RecordDeliveryStatusInput): Promise<RecordDeliveryStatusResult> {
    this.deliveryStatusInputs.push(input);

    return this.deliveryStatusResult ?? {
      matched: true,
      insertedEvent: true,
      currentStatus: input.status,
    };
  }

  public async updateState(input: UpdateMessageStateInput): Promise<void> {
    this.updates.push(input);
  }

  public async updateMediaInfo(messageId: string, mediaInfo: Record<string, unknown>): Promise<void> {
    this.mediaInfoUpdates.push({ messageId, mediaInfo });
  }
}

class FakeRoutingRepository implements RoutingRepository {
  public options: ActiveRoutingOption[] = [];

  public async getActiveOptions(): Promise<ActiveRoutingOption[]> {
    return this.options;
  }

  public async findAssignmentByQueueId(_queueId: number): Promise<RoutingQueueAssignment | null> {
    return null;
  }
}

class FakeSettingsService {
  private readonly fallbacks = new Map<MessageSettingKey, string>([
    ['menu_message', 'Escolha uma opÃ§Ã£o:'],
    ['invalid_option_message', 'Nao entendi sua opcao. Por favor, escolha uma das opcoes abaixo:'],
    ['invalid_media_message', 'Por favor, envie apenas texto para escolher uma opcao.'],
    ['error_fallback_message', 'Tivemos uma instabilidade. Tente novamente mais tarde.'],
    ['ticket_created_message', 'Seu chamado #{ticket_id} foi aberto.'],
    ['conversation_closed_message', 'Esta conversa esta encerrada. Inicie um novo atendimento.'],
    ['after_hours_message', 'Estamos fora do horario. Retornamos amanha.'],
  ]);

  public messages = new Map<MessageSettingKey, string>(this.fallbacks);

  public async getMessage(key: MessageSettingKey): Promise<string> {
    return this.messages.get(key)?.trim() || this.fallbacks.get(key) || `[${key}]`;
  }

  public async formatMessage(key: MessageSettingKey, placeholders: { ticketId?: number | string } = {}): Promise<string> {
    const message = await this.getMessage(key);
    return message.replace(/\{ticket_id\}/g, String(placeholders.ticketId ?? ''));
  }
}

class FakeScheduleService {
  public open = true;
  public shouldSend = true;
  public checked = 0;
  public rateLimitChecks: string[] = [];

  public async isOpen(): Promise<boolean> {
    this.checked += 1;
    return this.open;
  }

  public shouldSendAfterHoursMessage(phoneE164: string): boolean {
    this.rateLimitChecks.push(phoneE164);
    return this.shouldSend;
  }
}

class FakeConversationRepository implements ConversationRepository {
  public reusableConversation: Conversation | null = null;
  public pendingGlpiOrphanConversation: Conversation | null = null;
  public latestClosedConversation: Conversation | null = null;
  public touchedConversationIds: string[] = [];
  public updatedStatuses: Array<{ conversationId: string; status: string }> = [];
  public updatedQueuesAndStatuses: Array<{ conversationId: string; queueId: number | null; status: string }> = [];
  public profileStates: Array<{ conversationId: string; state: Record<string, unknown> }> = [];
  public reopenedConversationIds: string[] = [];
  public createdCount = 0;
  public lastCreateInput: CreateConversationInput | null = null;
  public linkedTickets: Array<{
    conversationId: string;
    ticketId: number;
    queueId?: number | null;
    glpiEntityId?: number | null;
    glpiEntityName?: string | null;
  }> = [];
  public entityAttempts = new Map<string, EntitySelectionAttempt>();

  public async findReusableByPhoneE164(_phoneE164: string): Promise<Conversation | null> {
    return this.reusableConversation;
  }

  public async findPendingGlpiOrphanByPhoneE164(_phoneE164: string): Promise<Conversation | null> {
    return this.pendingGlpiOrphanConversation;
  }

  public async findLatestClosedByPhoneE164(_phoneE164: string): Promise<Conversation | null> {
    return this.latestClosedConversation;
  }

  public async findById(conversationId: string): Promise<Conversation | null> {
    if (this.reusableConversation && this.reusableConversation.id === conversationId) {
      return this.reusableConversation;
    }
    return null;
  }

  public async findByIdAndGlpiTicketId(_conversationId: string, _glpiTicketId: number): Promise<Conversation | null> {
    const candidates = [
      this.reusableConversation,
      this.pendingGlpiOrphanConversation,
      this.latestClosedConversation,
    ];
    const found = candidates.find(
      (conversation) =>
        conversation?.id === _conversationId
        && conversation.glpiTicketId === _glpiTicketId,
    );
    if (found) {
      return found;
    }

    return null;
  }

  public async create(input: CreateConversationInput): Promise<Conversation> {
    this.createdCount += 1;
    this.lastCreateInput = input;

    return {
      id: 'conversation-1',
      phoneE164: input.phoneE164,
      contactId: input.contactId,
      glpiTicketId: input.glpiTicketId,
      queueId: null,
      profileCollectionState: input.status === 'collecting_contact_profile' ? { step: 'asking_company' } : null,
      status: input.status,
      lastMessageAt: input.lastMessageAt,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  public async linkGlpiTicket(
    conversationId: string,
    ticketId: number,
    queueId?: number | null,
    glpiEntityId?: number | null,
    glpiEntityName?: string | null,
  ): Promise<boolean> {
    const entry: {
      conversationId: string;
      ticketId: number;
      queueId?: number | null;
      glpiEntityId?: number | null;
      glpiEntityName?: string | null;
    } = { conversationId, ticketId };
    if (queueId !== undefined) {
      entry.queueId = queueId;
    }
    if (glpiEntityId !== undefined) {
      entry.glpiEntityId = glpiEntityId;
    }
    if (glpiEntityName !== undefined) {
      entry.glpiEntityName = glpiEntityName;
    }
    this.linkedTickets.push(entry);
    return true;
  }

  public async updateStatus(conversationId: string, status: string): Promise<void> {
    this.updatedStatuses.push({ conversationId, status });
  }

  public async updateQueueAndStatus(conversationId: string, queueId: number | null, status: string): Promise<void> {
    this.updatedQueuesAndStatuses.push({ conversationId, queueId, status });
    if (this.reusableConversation && this.reusableConversation.id === conversationId) {
      this.reusableConversation = {
        ...this.reusableConversation,
        queueId,
        status,
      };
    }
  }

  public async updateProfileCollectionState(conversationId: string, state: Record<string, unknown>): Promise<void> {
    this.profileStates.push({ conversationId, state });
    if (this.reusableConversation && this.reusableConversation.id === conversationId) {
      this.reusableConversation = {
        ...this.reusableConversation,
        profileCollectionState: state,
      };
    }
  }

  public async reopenConversation(conversationId: string): Promise<void> {
    this.reopenedConversationIds.push(conversationId);
    this.updatedStatuses.push({ conversationId, status: 'open' });
  }

  public async touch(conversationId: string, _occurredAt: Date): Promise<void> {
    this.touchedConversationIds.push(conversationId);
  }

  public async reserveEntitySelectionAttempt(
    conversationId: string,
    glpiEntityId = 1,
    glpiEntityName: string | null = null,
  ): Promise<EntitySelectionAttemptReserveResult> {
    const existing = this.entityAttempts.get(conversationId);
    if (existing) {
      return { wasCreated: false, attempt: existing };
    }

    const attempt: EntitySelectionAttempt = {
      id: `attempt-${conversationId}`,
      conversationId,
      status: 'processing',
      glpiEntityId,
      glpiEntityName,
      glpiTicketId: null,
      errorMessage: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.entityAttempts.set(conversationId, attempt);

    return { wasCreated: true, attempt };
  }

  public async findEntitySelectionAttemptByConversationId(
    conversationId: string,
  ): Promise<EntitySelectionAttempt | null> {
    return this.entityAttempts.get(conversationId) ?? null;
  }

  public async markEntitySelectionAttemptSucceeded(attemptId: string, glpiTicketId: number): Promise<void> {
    for (const attempt of this.entityAttempts.values()) {
      if (attempt.id === attemptId) {
        attempt.status = 'succeeded';
        attempt.glpiTicketId = glpiTicketId;
      }
    }
  }

  public async markEntitySelectionAttemptFailedBeforeTicket(attemptId: string, errorMessage: string): Promise<void> {
    for (const attempt of this.entityAttempts.values()) {
      if (attempt.id === attemptId) {
        attempt.status = 'failed_before_ticket';
        attempt.errorMessage = errorMessage;
      }
    }
  }

  public async markEntitySelectionAttemptFailedAfterTicket(
    attemptId: string,
    glpiTicketId: number,
    errorMessage: string,
  ): Promise<void> {
    for (const attempt of this.entityAttempts.values()) {
      if (attempt.id === attemptId) {
        attempt.status = 'failed_after_ticket';
        attempt.glpiTicketId = glpiTicketId;
        attempt.errorMessage = errorMessage;
      }
    }
  }
}

class FakeSolutionActionRepository implements SolutionActionRepository {
  public actions = new Map<string, SolutionAction>();
  public successfulAction: SolutionAction | null = null;
  public reserveCalls: ReserveSolutionActionInput[] = [];
  public markSuccessCalls: Array<{ id: string; finalTicketStatus: number }> = [];
  public markErrorCalls: Array<{ id: string; errorCode: string; errorMessage: string }> = [];
  public markIgnoredCalls: Array<{ id: string; errorCode: string; errorMessage: string }> = [];

  public async reserveAction(input: ReserveSolutionActionInput): Promise<ReserveSolutionActionResult> {
    this.reserveCalls.push(input);
    const existing = this.actions.get(input.whatsappMessageId);
    if (existing) {
      return { reserved: false, action: existing };
    }

    const action: SolutionAction = {
      id: `solution-action-${this.actions.size + 1}`,
      actionKey: input.actionKey,
      whatsappMessageId: input.whatsappMessageId,
      ticketId: input.ticketId,
      conversationId: input.conversationId,
      phoneE164: input.phoneE164,
      action: input.action,
      status: 'processing',
      previousTicketStatus: input.previousTicketStatus,
      finalTicketStatus: null,
      errorCode: null,
      errorMessage: null,
      csatRating: input.csatRating ?? null,
      supervisorReviewRequired: input.supervisorReviewRequired === true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.actions.set(input.whatsappMessageId, action);
    return { reserved: true, action };
  }

  public async markSuccess(id: string, finalTicketStatus: number): Promise<void> {
    this.markSuccessCalls.push({ id, finalTicketStatus });
    for (const [messageId, action] of this.actions.entries()) {
      if (action.id === id) {
        this.actions.set(messageId, {
          ...action,
          status: 'success',
          finalTicketStatus,
          updatedAt: new Date(),
        });
        return;
      }
    }
  }

  public async markError(id: string, errorCode: string, errorMessage: string): Promise<void> {
    this.markErrorCalls.push({ id, errorCode, errorMessage });
    for (const [messageId, action] of this.actions.entries()) {
      if (action.id === id) {
        this.actions.set(messageId, {
          ...action,
          status: 'error',
          errorCode,
          errorMessage,
          updatedAt: new Date(),
        });
        return;
      }
    }
  }

  public async markIgnored(id: string, errorCode: string, errorMessage: string): Promise<void> {
    this.markIgnoredCalls.push({ id, errorCode, errorMessage });
    for (const [messageId, action] of this.actions.entries()) {
      if (action.id === id) {
        this.actions.set(messageId, {
          ...action,
          status: 'ignored',
          errorCode,
          errorMessage,
          updatedAt: new Date(),
        });
        return;
      }
    }
  }

  public async findByWhatsappMessageId(messageId: string): Promise<SolutionAction | null> {
    return this.actions.get(messageId) ?? null;
  }

  public async findSuccessfulAction(actionKey: string): Promise<SolutionAction | null> {
    if (this.successfulAction && this.successfulAction.actionKey === actionKey) {
      return this.successfulAction;
    }

    return [...this.actions.values()].find((action) => (
      action.actionKey === actionKey && action.status === 'success'
    )) ?? null;
  }
}

class FakeContactProfileService {
  public collectionEnabled = false;
  public profileComplete = true;
  public profile: ContactProfileData | null = null;
  public processResult: {
    state: Record<string, unknown>;
    reply: string;
    completed: boolean;
    profile: ContactProfileData | null;
  } | null = null;
  public savedTexts: string[] = [];
  public savedProfiles: ContactProfileData[] = [];
  public snapshots: Array<{ conversationId: string; contactId: string; phoneE164: string; profile: ContactProfileData | null }> = [];
  public prompt = 'Informe a empresa ou unidade.';
  public missingPrompt = 'Ainda preciso de: resumo do problema.';

  public async isCollectionEnabled(): Promise<boolean> {
    return this.collectionEnabled;
  }

  public async findProfile(_contactId: string): Promise<ContactProfileData | null> {
    return this.profile;
  }

  public async saveProfileFromText(_contactId: string, phoneE164: string, text: string): Promise<ContactProfileData> {
    this.savedTexts.push(text);
    this.profile = {
      phone_e164: phoneE164,
      requester_name: 'Maria',
      company_name_raw: 'Empresa',
      last_equipment_tag: '2022',
      equipment_tag_unknown: false,
      last_problem_summary: text,
      profile_status: 'complete',
      profile_source: 'whatsapp',
      confirmation_count: 1,
      last_confirmed_at: new Date().toISOString(),
    };
    return this.profile;
  }

  public async saveProfileData(
    phoneE164: string,
    profile: ContactProfileData,
    _conversationId?: string | null,
  ): Promise<ContactProfileData> {
    this.profile = { ...profile, phone_e164: phoneE164 };
    this.savedProfiles.push(this.profile);
    return this.profile;
  }

  public async createSnapshot(
    conversationId: string,
    contactId: string,
    phoneE164: string,
    profile: ContactProfileData | null,
  ): Promise<ContactProfileData | null> {
    this.snapshots.push({ conversationId, contactId, phoneE164, profile });
    return profile;
  }

  public async isProfileComplete(_profile: ContactProfileData): Promise<boolean> {
    return this.profileComplete;
  }

  public isReliableForConfirmation(profile: ContactProfileData | null | undefined): profile is ContactProfileData {
    if (!profile || profile.profile_status !== 'complete') {
      return false;
    }
    const hasIdentity = Boolean(profile.requester_name?.trim()) && Boolean(profile.company_name_raw?.trim());
    const hasReliableTag = profile.equipment_tag_unknown || /^\d{4}$/.test(profile.last_equipment_tag ?? '');
    return hasIdentity && hasReliableTag;
  }

  public async buildMissingFieldsPrompt(_profile: ContactProfileData): Promise<string> {
    return this.missingPrompt;
  }

  public async getInitialPrompt(): Promise<string> {
    return this.prompt;
  }

  public startNewCollectionState(queueLabel?: string | null): Record<string, unknown> {
    return { step: 'asking_company', queue_label: queueLabel ?? null };
  }

  public startExistingProfileConfirmationState(
    profile: ContactProfileData,
    queueLabel?: string | null,
  ): Record<string, unknown> {
    return {
      step: 'confirming_existing_profile',
      queue_label: queueLabel ?? null,
      company_name_raw: profile.company_name_raw,
      requester_name: profile.requester_name,
      last_equipment_tag: profile.last_equipment_tag,
      equipment_tag_unknown: profile.equipment_tag_unknown,
    };
  }

  public normalizeCollectionState(state: unknown): Record<string, unknown> {
    return typeof state === 'object' && state !== null && !Array.isArray(state)
      ? state as Record<string, unknown>
      : { step: 'asking_company' };
  }

  public getCollectionPrompt(state: Record<string, unknown>, profile: ContactProfileData | null = null): string {
    if (state.step === 'confirming_existing_profile') {
      return `Bom dia, ${profile?.requester_name ?? 'Maria'}.\n\nVoce fala da empresa ${profile?.company_name_raw ?? 'Empresa'} e sua etiqueta e ${profile?.last_equipment_tag ?? 'ABC123'}.\n\nAs informacoes estao corretas?`;
    }

    if (state.step === 'asking_name') {
      return 'Informe seu nome completo.';
    }

    if (state.step === 'asking_tag') {
      return 'Informe a etiqueta/patrimônio do equipamento com 4 números. Se não souber, use o botão "Não sei".';
    }

    if (state.step === 'asking_reason') {
      return 'Qual o motivo do seu contato? Resuma em ate 200 caracteres.';
    }

    return this.prompt;
  }

  public processCollectionResponse(input: {
    phoneE164: string;
    state: Record<string, unknown>;
    text: string;
  }): { state: Record<string, unknown>; reply: string; completed: boolean; profile: ContactProfileData | null } {
    if (this.processResult) {
      return this.processResult;
    }

    const step = String(input.state.step ?? 'asking_company');
    if (step === 'asking_company') {
      return {
        state: { ...input.state, step: 'asking_name', company_name_raw: input.text },
        reply: 'Informe seu nome completo.',
        completed: false,
        profile: null,
      };
    }

    if (step === 'asking_name') {
      return {
        state: { ...input.state, step: 'asking_tag', requester_name: input.text },
        reply: this.getCollectionPrompt({ ...input.state, step: 'asking_tag' }),
        completed: false,
        profile: null,
      };
    }

    const profile: ContactProfileData = {
      phone_e164: input.phoneE164,
      requester_name: 'Maria',
      company_name_raw: 'Empresa',
      last_equipment_tag: '2022',
      equipment_tag_unknown: false,
      last_problem_summary: input.text,
      profile_status: 'complete',
      profile_source: 'whatsapp',
      confirmation_count: 1,
      last_confirmed_at: new Date().toISOString(),
    };

    return {
      state: { ...input.state, step: 'complete', reason: input.text },
      reply: 'Obrigado. Seus dados foram registrados.',
      completed: true,
      profile,
    };
  }

  public async enrichTicketPayload(input: {
    baseTitle: string;
    baseContent: string;
    profile: ContactProfileData | null;
  }): Promise<{ title: string; content: string }> {
    if (!input.profile) {
      return { title: input.baseTitle, content: input.baseContent };
    }

    return {
      title: `[WA][Suporte] ${input.profile.company_name_raw} - ${input.profile.requester_name}`,
      content: `${input.baseContent}\n\nPerfil: ${input.profile.requester_name}`,
    };
  }
}

class FakeContactEntityResolutionService {
  public mode: 'use_default_entity' | 'defer_until_known' = 'use_default_entity';

  public async getMode(): Promise<'use_default_entity' | 'defer_until_known'> {
    return this.mode;
  }
}

class FakeContactEntityMemoryRepository {
  public memory: ContactEntityMemory | null = null;

  public async findActiveByPhone(_phoneE164: string): Promise<ContactEntityMemory | null> {
    return this.memory;
  }

  public async rememberEntityForPhone(): Promise<ContactEntityMemory> {
    throw new Error('not used in inbound tests');
  }
}

function makeEntityMemory(overrides: Partial<ContactEntityMemory> = {}): ContactEntityMemory {
  return {
    id: 'entity-memory-1',
    phoneE164: '+5511999999999',
    contactId: 'contact-1',
    glpiEntityId: 321,
    glpiEntityName: 'Entidade memorizada',
    sourceTicketId: null,
    sourceConversationId: 'previous-conversation',
    source: 'manual',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeEntityMemoryRepository(
  memory: ContactEntityMemory = makeEntityMemory(),
): FakeContactEntityMemoryRepository {
  const repository = new FakeContactEntityMemoryRepository();
  repository.memory = memory;
  return repository;
}

const resolvedContact: Contact = {
  id: 'contact-1',
  phoneE164: '+5511999999999',
  glpiContactId: 111,
  glpiUserId: 222,
  name: 'Contato',
  source: 'glpi_api',
  cacheKey: 'glpi_plugin_integaglpi:contact:phone:+5511999999999',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const basePayload = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'entry-1',
      changes: [
        {
          field: 'messages',
          value: {
            metadata: {
              display_phone_number: '5511300000000',
            },
            contacts: [
              {
                profile: {
                  name: 'Contato',
                },
              },
            ],
            messages: [
              {
                id: 'wamid.123',
                from: '5511999999999',
                type: 'text',
                text: {
                  body: 'hello',
                },
              },
            ],
          },
        },
      ],
    },
  ],
} as const;

function makeInboundService(
  webhookEventRepository: FakeWebhookEventRepository,
  messageRepository: FakeMessageRepository,
  conversationRepository: FakeConversationRepository,
  contactResolutionService: { resolve: ReturnType<typeof vi.fn> },
  glpiClient: {
    createTicket: ReturnType<typeof vi.fn>;
    addFollowUp?: ReturnType<typeof vi.fn>;
    getTicketStatus?: ReturnType<typeof vi.fn>;
    getTicket?: ReturnType<typeof vi.fn>;
    closeTicket?: ReturnType<typeof vi.fn>;
    reopenTicket?: ReturnType<typeof vi.fn>;
    reopenTicketSolution?: ReturnType<typeof vi.fn>;
  },
  extras?: {
    routing?: FakeRoutingRepository;
    settings?: FakeSettingsService;
    schedule?: FakeScheduleService;
    meta?: {
      sendTextMessage: ReturnType<typeof vi.fn>;
      sendReplyButtons?: ReturnType<typeof vi.fn>;
      sendListMessage?: ReturnType<typeof vi.fn>;
    };
    mediaProcessing?: { processMedia: ReturnType<typeof vi.fn> };
    solutionActions?: FakeSolutionActionRepository;
    audit?: AuditService;
    contactProfile?: FakeContactProfileService;
    entityResolution?: FakeContactEntityResolutionService;
    entityMemory?: FakeContactEntityMemoryRepository;
    messageConfiguration?: unknown;
  },
): InboundWebhookService {
  const routing = extras?.routing ?? new FakeRoutingRepository();
  const settings = extras?.settings ?? new FakeSettingsService();
  const schedule = extras?.schedule ?? new FakeScheduleService();
  const meta = extras?.meta ?? { sendTextMessage: vi.fn().mockResolvedValue({}) };

  return new InboundWebhookService(
    webhookEventRepository,
    messageRepository,
    conversationRepository,
    contactResolutionService as never,
    glpiClient as never,
    new FakeKeyLock(),
    routing,
    settings,
    schedule,
    meta as never,
    null,
    extras?.solutionActions ?? null,
    extras?.audit ?? null,
    (extras?.entityResolution ?? null) as never,
    (extras?.entityMemory ?? null) as never,
    (extras?.contactProfile ?? null) as never,
    (extras?.mediaProcessing ?? null) as never,
    (extras?.messageConfiguration ?? null) as never,
  );
}

const sampleRoutingOptions: ActiveRoutingOption[] = [
  {
    id: 1,
    label: 'Suporte',
    optionKey: 'suporte',
    queueId: 5,
    glpiGroupId: 10,
    glpiUserId: null,
    confirmationMessage: 'Obrigado! Chamado #{ticket_id} encaminhado ao Suporte.',
    sortOrder: 1,
  },
  {
    id: 2,
    label: 'Financeiro',
    optionKey: 'fin',
    queueId: 6,
    glpiGroupId: null,
    glpiUserId: 20,
    confirmationMessage: null,
    sortOrder: 2,
  },
];

const fourRoutingOptions: ActiveRoutingOption[] = [
  ...sampleRoutingOptions,
  {
    id: 3,
    label: 'Comercial',
    optionKey: 'comercial',
    queueId: 7,
    glpiGroupId: null,
    glpiUserId: null,
    confirmationMessage: null,
    sortOrder: 3,
  },
  {
    id: 4,
    label: 'Ouvidoria',
    optionKey: 'ouvidoria',
    queueId: 8,
    glpiGroupId: null,
    glpiUserId: null,
    confirmationMessage: null,
    sortOrder: 4,
  },
];

describe('InboundWebhookService', () => {
  it('does not process duplicate messages again', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    messageRepository.reservedMessage = null;
    const conversationRepository = new FakeConversationRepository();
    const contactResolutionService = {
      resolve: vi.fn(),
    };
    const glpiClient = {
      createTicket: vi.fn(),
      addFollowUp: vi.fn(),
    };

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
    );

    const result = await service.process(basePayload);

    expect(result.results).toEqual([{ messageId: 'wamid.123', outcome: 'duplicate' }]);
    expect(glpiClient.createTicket).not.toHaveBeenCalled();
    expect(glpiClient.addFollowUp).not.toHaveBeenCalled();
    expect(webhookEventRepository.updates[0]?.processingStatus).toBe('duplicate');
  });

  it('records WEBHOOK_DUPLICATED audit event when duplicate path is detected', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    messageRepository.reservedMessage = null;
    const conversationRepository = new FakeConversationRepository();
    const audit = {
      recordAuditEventFireAndForget: vi.fn(),
    } as unknown as AuditService;
    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      { resolve: vi.fn() },
      { createTicket: vi.fn(), addFollowUp: vi.fn() },
      { audit },
    );

    await service.process(basePayload, { correlationId: 'WA-20260510153022-a8f3c2' });

    expect(audit.recordAuditEventFireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({
        correlationId: 'WA-20260510153022-a8f3c2',
        eventType: 'WEBHOOK_DUPLICATED',
        status: 'duplicated',
        messageId: 'wamid.123',
      }),
    );
  });

  it('records delivery status when webhook has statuses and no inbound messages', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    const contactResolutionService = { resolve: vi.fn() };
    const glpiClient = { createTicket: vi.fn(), addFollowUp: vi.fn() };
    const audit = {
      recordAuditEventFireAndForget: vi.fn(),
    } as unknown as AuditService;
    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
      { audit },
    );
    const statusOnlyPayload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'entry-1',
          changes: [
            {
              field: 'messages',
              value: {
                metadata: {
                  display_phone_number: '5511300000000',
                },
                statuses: [{
                  id: 'wamid.status-only',
                  status: 'delivered',
                  timestamp: '1779028800',
                }],
              },
            },
          ],
        },
      ],
    } as const;

    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    const result = await service.process(statusOnlyPayload, { correlationId: 'WA-20260510153022-a8f3c2' });

    expect(result).toEqual({
      results: [{
        messageId: 'wamid.status-only',
        outcome: 'processed',
      }],
    });
    expect(audit.recordAuditEventFireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({
        correlationId: 'WA-20260510153022-a8f3c2',
        eventType: 'MESSAGE_DELIVERY_STATUS',
        status: 'success',
        severity: 'info',
        source: 'InboundWebhookService',
        payload: expect.objectContaining({
          delivery_event_type: 'DELIVERY_STATUS_UPDATED',
        }),
      }),
    );
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'DELIVERY_STATUS_RECEIVED',
        delivery_status: 'delivered',
        meta_message_id_masked: expect.not.stringContaining('wamid.status-only'),
      }),
      '[integration-service][delivery][DELIVERY_STATUS_RECEIVED]',
    );
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'DELIVERY_STATUS_UPDATED',
        delivery_status: 'delivered',
        matched: true,
        inserted_event: true,
      }),
      '[integration-service][delivery][DELIVERY_STATUS_UPDATED]',
    );
    info.mockRestore();
    expect(contactResolutionService.resolve).not.toHaveBeenCalled();
    expect(glpiClient.createTicket).not.toHaveBeenCalled();
    expect(messageRepository.reservedInputs).toHaveLength(0);
    expect(messageRepository.deliveryStatusInputs).toEqual([
      expect.objectContaining({
        metaMessageId: 'wamid.status-only',
        status: 'delivered',
        correlationId: 'WA-20260510153022-a8f3c2',
      }),
    ]);
  });

  it('sanitizes failed delivery status errors before persistence', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      { resolve: vi.fn() },
      { createTicket: vi.fn(), addFollowUp: vi.fn() },
      { audit: { recordAuditEventFireAndForget: vi.fn() } as unknown as AuditService },
    );
    const payload = {
      object: 'whatsapp_business_account',
      entry: [{
        id: 'entry-1',
        changes: [{
          field: 'messages',
          value: {
            metadata: { display_phone_number: '5511300000000' },
            statuses: [{
              id: 'wamid.failed',
              status: 'failed',
              errors: [{
                code: 131047,
                title: 'Re-engagement message',
                message: 'Use https://graph.facebook.com/token and phone 5541999999999',
              }],
            }],
          },
        }],
      }],
    } as const;

    await service.process(payload, { correlationId: 'WA-20260510153022-a8f3c2' });

    expect(messageRepository.deliveryStatusInputs[0]).toEqual(expect.objectContaining({
      metaMessageId: 'wamid.failed',
      status: 'failed',
      errorCode: '131047',
      errorMessageSanitized: expect.stringContaining('[URL_REMOVIDA]'),
    }));
    expect(messageRepository.deliveryStatusInputs[0]?.errorMessageSanitized).not.toContain('5541999999999');
  });

  it('records read status without processing inbound flow', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    const contactResolutionService = { resolve: vi.fn() };
    const glpiClient = { createTicket: vi.fn(), addFollowUp: vi.fn() };
    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
    );
    const payload = {
      object: 'whatsapp_business_account',
      entry: [{
        id: 'entry-1',
        changes: [{
          field: 'messages',
          value: {
            metadata: { display_phone_number: '5511300000000' },
            statuses: [{
              id: 'wamid.read',
              status: 'read',
              timestamp: '1779028860',
              recipient_id: '5541999999999',
            }],
          },
        }],
      }],
    } as const;

    await service.process(payload, { correlationId: 'WA-20260510153022-a8f3c2' });

    expect(messageRepository.deliveryStatusInputs).toEqual([
      expect.objectContaining({
        metaMessageId: 'wamid.read',
        status: 'read',
        receivedAt: new Date(1779028860 * 1000),
      }),
    ]);
    expect(messageRepository.reservedInputs).toHaveLength(0);
    expect(contactResolutionService.resolve).not.toHaveBeenCalled();
    expect(glpiClient.createTicket).not.toHaveBeenCalled();
  });

  it('logs duplicate delivery status as ignored while preserving idempotent repository write', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    messageRepository.deliveryStatusResult = {
      matched: true,
      insertedEvent: false,
      currentStatus: 'delivered',
    };
    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      new FakeConversationRepository(),
      { resolve: vi.fn() },
      { createTicket: vi.fn(), addFollowUp: vi.fn() },
      { audit: { recordAuditEventFireAndForget: vi.fn() } as unknown as AuditService },
    );
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    const payload = {
      object: 'whatsapp_business_account',
      entry: [{
        id: 'entry-1',
        changes: [{
          field: 'messages',
          value: {
            metadata: { display_phone_number: '5511300000000' },
            statuses: [{ id: 'wamid.duplicate', status: 'delivered' }],
          },
        }],
      }],
    } as const;

    await service.process(payload, { correlationId: 'WA-20260510153022-a8f3c2' });

    expect(messageRepository.deliveryStatusInputs).toHaveLength(1);
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'DELIVERY_STATUS_IGNORED',
        status: 'ignored',
        reason: 'duplicate_status_event',
        inserted_event: false,
      }),
      '[integration-service][delivery][DELIVERY_STATUS_IGNORED]',
    );
    info.mockRestore();
  });

  it('logs unmatched delivery status as ignored without leaking the full WAMID', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    messageRepository.deliveryStatusResult = {
      matched: false,
      insertedEvent: false,
      currentStatus: null,
    };
    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      new FakeConversationRepository(),
      { resolve: vi.fn() },
      { createTicket: vi.fn(), addFollowUp: vi.fn() },
    );
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    const payload = {
      object: 'whatsapp_business_account',
      entry: [{
        id: 'entry-1',
        changes: [{
          field: 'messages',
          value: {
            metadata: { display_phone_number: '5511300000000' },
            statuses: [{ id: 'wamid.not-found', status: 'delivered' }],
          },
        }],
      }],
    } as const;

    await service.process(payload, { correlationId: 'WA-20260510153022-a8f3c2' });

    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'DELIVERY_STATUS_IGNORED',
        reason: 'message_not_found',
        matched: false,
        meta_message_id_masked: expect.not.stringContaining('wamid.not-found'),
      }),
      '[integration-service][delivery][DELIVERY_STATUS_IGNORED]',
    );
    info.mockRestore();
  });

  it('is safe under concurrency for the same message_id (processes only once)', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    const contactResolutionService = {
      resolve: vi.fn().mockResolvedValue(resolvedContact),
    };
    const glpiClient = {
      createTicket: vi.fn().mockResolvedValue(321),
      addFollowUp: vi.fn(),
    };
    const entityMemory = makeEntityMemoryRepository();

    let reserved = false;
    messageRepository.reserveInbound = vi.fn(async (input) => {
      if (reserved) {
        return null;
      }
      reserved = true;
      return {
        ...(messageRepository.reservedMessage as NonNullable<typeof messageRepository.reservedMessage>),
        messageId: input.messageId,
        senderPhone: input.senderPhone,
        recipientPhone: input.recipientPhone,
        messageText: input.messageText,
        rawPayload: input.rawPayload,
      };
    });

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
      { entityMemory },
    );

    const [first, second] = await Promise.all([service.process(basePayload), service.process(basePayload)]);

    const outcomes = [first.results[0]?.outcome, second.results[0]?.outcome].sort();
    expect(outcomes).toEqual(['duplicate', 'processed']);
    expect(glpiClient.createTicket).toHaveBeenCalledTimes(1);
  });

  it('creates a new GLPI ticket for the first message when no reusable conversation exists', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    const contactResolutionService = {
      resolve: vi.fn().mockResolvedValue(resolvedContact),
    };
    const glpiClient = {
      createTicket: vi.fn().mockResolvedValue(321),
      addFollowUp: vi.fn(),
    };
    const entityMemory = makeEntityMemoryRepository();

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
      { entityMemory },
    );

    const result = await service.process(basePayload);

    expect(result.results).toEqual([{ messageId: 'wamid.123', outcome: 'processed' }]);
    expect(glpiClient.createTicket).toHaveBeenCalledTimes(1);
    expect(glpiClient.createTicket).toHaveBeenCalledWith(expect.objectContaining({
      entitiesId: 321,
    }));
    expect(glpiClient.addFollowUp).not.toHaveBeenCalled();
    expect(conversationRepository.createdCount).toBe(1);
    expect(messageRepository.updates[0]).toEqual({
      messageId: 'wamid.123',
      conversationId: 'conversation-1',
      processingStatus: 'processed',
      glpiSyncStatus: 'synced',
    });
    expect(webhookEventRepository.updates[0]?.processingStatus).toBe('processed');
  });

  it('keeps the standard flow when routing options are empty', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    const routing = new FakeRoutingRepository();
    const meta = { sendTextMessage: vi.fn().mockResolvedValue({}) };
    const contactResolutionService = {
      resolve: vi.fn().mockResolvedValue(resolvedContact),
    };
    const glpiClient = {
      createTicket: vi.fn().mockResolvedValue(321),
      addFollowUp: vi.fn(),
    };
    const entityMemory = makeEntityMemoryRepository();

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
      { routing, meta, entityMemory },
    );

    const result = await service.process(basePayload);

    expect(result.results).toEqual([{ messageId: 'wamid.123', outcome: 'processed' }]);
    expect(meta.sendTextMessage).not.toHaveBeenCalled();
    expect(glpiClient.createTicket).toHaveBeenCalledTimes(1);
    expect(conversationRepository.lastCreateInput?.status).toBe('open');
  });

  it('does not create a first ticket without entity memory when routing options are empty', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    const routing = new FakeRoutingRepository();
    const meta = { sendTextMessage: vi.fn().mockResolvedValue({}) };
    const contactResolutionService = {
      resolve: vi.fn().mockResolvedValue(resolvedContact),
    };
    const glpiClient = {
      createTicket: vi.fn().mockResolvedValue(321),
      addFollowUp: vi.fn(),
    };

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
      { routing, meta },
    );

    const result = await service.process(basePayload);

    expect(result.results).toEqual([{ messageId: 'wamid.123', outcome: 'processed' }]);
    expect(glpiClient.createTicket).not.toHaveBeenCalled();
    expect(conversationRepository.lastCreateInput?.status).toBe('awaiting_entity_selection');
    expect(conversationRepository.updatedQueuesAndStatuses[0]).toEqual({
      conversationId: 'conversation-1',
      queueId: null,
      status: 'awaiting_entity_selection',
    });
    expect(meta.sendTextMessage.mock.calls[0]?.[0].body).toBe('Recebemos as suas informações, em breve um de nossos técnicos irá seguir com o atendimento.');
  });

  it('sends after-hours notice without blocking a new routed flow', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    const routing = new FakeRoutingRepository();
    routing.options = sampleRoutingOptions;
    const settings = new FakeSettingsService();
    settings.messages.set('after_hours_message', 'Atendimento encerrado por hoje.');
    const schedule = new FakeScheduleService();
    schedule.open = false;
    const meta = { sendTextMessage: vi.fn().mockResolvedValue({}) };
    const contactResolutionService = {
      resolve: vi.fn().mockResolvedValue(resolvedContact),
    };
    const glpiClient = {
      createTicket: vi.fn(),
      addFollowUp: vi.fn(),
    };

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
      { routing, settings, schedule, meta },
    );

    const result = await service.process(basePayload);

    expect(result.results).toEqual([{ messageId: 'wamid.123', outcome: 'processed' }]);
    expect(schedule.checked).toBe(1);
    expect(schedule.rateLimitChecks).toEqual(['+5511999999999']);
    expect(meta.sendTextMessage).toHaveBeenCalledTimes(2);
    expect(meta.sendTextMessage.mock.calls[0]?.[0].body).toBe('Atendimento encerrado por hoje.');
    expect(glpiClient.createTicket).not.toHaveBeenCalled();
    expect(conversationRepository.createdCount).toBe(1);
    expect(messageRepository.updates.at(-1)).toEqual(expect.objectContaining({
      messageId: 'wamid.123',
      processingStatus: 'processed',
      glpiSyncStatus: 'synced',
    }));
    expect(webhookEventRepository.updates[0]?.processingStatus).toBe('processed');
  });

  it('does not repeat after-hours notice while rate limited and keeps the flow moving', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    const schedule = new FakeScheduleService();
    schedule.open = false;
    schedule.shouldSend = false;
    const meta = { sendTextMessage: vi.fn().mockResolvedValue({}) };
    const contactResolutionService = {
      resolve: vi.fn().mockResolvedValue(resolvedContact),
    };
    const glpiClient = {
      createTicket: vi.fn(),
      addFollowUp: vi.fn(),
    };

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
      { schedule, meta },
    );

    const result = await service.process(basePayload);

    expect(result.results).toEqual([{ messageId: 'wamid.123', outcome: 'processed' }]);
    expect(meta.sendTextMessage).toHaveBeenCalledTimes(1);
    expect(meta.sendTextMessage.mock.calls[0]?.[0].body).toBe('Recebemos as suas informações, em breve um de nossos técnicos irá seguir com o atendimento.');
    expect(glpiClient.createTicket).not.toHaveBeenCalled();
    expect(conversationRepository.createdCount).toBe(1);
    expect(messageRepository.updates[0]?.processingStatus).toBe('processed');
  });

  it('reuses the existing conversation and adds a follow-up on the same GLPI ticket', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    conversationRepository.reusableConversation = {
      id: 'conversation-existing',
      phoneE164: '+5511999999999',
      contactId: 'contact-1',
      glpiTicketId: 654,
      queueId: null,
      status: 'open',
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const contactResolutionService = {
      resolve: vi.fn().mockResolvedValue(resolvedContact),
    };
    const glpiClient = {
      createTicket: vi.fn(),
      addFollowUp: vi.fn().mockResolvedValue(998),
      getTicketStatus: vi.fn().mockResolvedValue('open'),
    };

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
    );

    const result = await service.process(basePayload);

    expect(result.results).toEqual([{ messageId: 'wamid.123', outcome: 'processed' }]);
    expect(glpiClient.createTicket).not.toHaveBeenCalled();
    expect(glpiClient.addFollowUp).toHaveBeenCalledTimes(1);
    expect(glpiClient.addFollowUp).toHaveBeenCalledWith({
      ticketId: 654,
      content: expect.stringContaining('Mensagem recebida via WhatsApp'),
    });
    expect(conversationRepository.touchedConversationIds).toEqual(['conversation-existing']);
    expect(messageRepository.updates[0]).toEqual({
      messageId: 'wamid.123',
      conversationId: 'conversation-existing',
      processingStatus: 'processed',
      glpiSyncStatus: 'synced',
    });
    expect(webhookEventRepository.updates[0]?.processingStatus).toBe('processed');
  });

  it('adds WhatsApp reply context to the GLPI follow-up when Meta context.id is present', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    messageRepository.messagesById.set('wamid.original', {
      ...(messageRepository.reservedMessage as NonNullable<typeof messageRepository.reservedMessage>),
      messageId: 'wamid.original',
      messageText: 'Mensagem original que o cliente respondeu',
    });
    const conversationRepository = new FakeConversationRepository();
    conversationRepository.reusableConversation = {
      id: 'conversation-existing',
      phoneE164: '+5511999999999',
      contactId: 'contact-1',
      glpiTicketId: 654,
      queueId: null,
      status: 'open',
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const contactResolutionService = {
      resolve: vi.fn().mockResolvedValue(resolvedContact),
    };
    const glpiClient = {
      createTicket: vi.fn(),
      addFollowUp: vi.fn().mockResolvedValue(998),
      getTicketStatus: vi.fn().mockResolvedValue('open'),
    };
    const replyPayload = structuredClone(basePayload) as typeof basePayload;
    replyPayload.entry[0].changes[0].value.messages[0] = {
      id: 'wamid.reply',
      from: '5511999999999',
      type: 'text',
      context: { id: 'wamid.original', from: '5511300000000' },
      text: { body: 'Respondendo a original' },
    } as never;

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
    );

    await service.process(replyPayload);

    expect(messageRepository.reservedInputs[0]?.rawPayload).toMatchObject({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    context: { id: 'wamid.original', from: '5511300000000' },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(glpiClient.addFollowUp).toHaveBeenCalledWith({
      ticketId: 654,
      content: expect.stringContaining('Em resposta a: Mensagem original que o cliente respondeu'),
    });
    expect(glpiClient.addFollowUp.mock.calls[0]?.[0].content).toContain('Respondendo a original');
  });

  it('adds WhatsApp reply context fallback to the GLPI follow-up when the original message is not local', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    conversationRepository.reusableConversation = {
      id: 'conversation-existing',
      phoneE164: '+5511999999999',
      contactId: 'contact-1',
      glpiTicketId: 654,
      queueId: null,
      status: 'open',
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const contactResolutionService = {
      resolve: vi.fn().mockResolvedValue(resolvedContact),
    };
    const glpiClient = {
      createTicket: vi.fn(),
      addFollowUp: vi.fn().mockResolvedValue(998),
      getTicketStatus: vi.fn().mockResolvedValue('open'),
    };
    const replyPayload = structuredClone(basePayload) as typeof basePayload;
    replyPayload.entry[0].changes[0].value.messages[0] = {
      id: 'wamid.reply-missing-original',
      from: '5511999999999',
      type: 'text',
      context: { id: 'wamid.original-not-local', from: '5511300000000' },
      text: { body: 'Resposta sem original local' },
    } as never;

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
    );

    await service.process(replyPayload);

    expect(glpiClient.addFollowUp).toHaveBeenCalledWith({
      ticketId: 654,
      content: expect.stringContaining('Em resposta a: mensagem WhatsApp wamid.original-not-local'),
    });
    expect(glpiClient.addFollowUp.mock.calls[0]?.[0].content).toContain('Resposta sem original local');
  });

  it('keeps append flow for an open conversation with ticket even when routing is active', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    conversationRepository.reusableConversation = {
      id: 'conversation-existing',
      phoneE164: '+5511999999999',
      contactId: 'contact-1',
      glpiTicketId: 654,
      queueId: 5,
      status: 'open',
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const routing = new FakeRoutingRepository();
    routing.options = sampleRoutingOptions;
    const meta = { sendTextMessage: vi.fn().mockResolvedValue({}) };
    const contactResolutionService = {
      resolve: vi.fn().mockResolvedValue(resolvedContact),
    };
    const glpiClient = {
      createTicket: vi.fn(),
      addFollowUp: vi.fn().mockResolvedValue(998),
      getTicketStatus: vi.fn().mockResolvedValue('open'),
    };

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
      { routing, meta },
    );

    const result = await service.process(basePayload);

    expect(result.results).toEqual([{ messageId: 'wamid.123', outcome: 'processed' }]);
    expect(meta.sendTextMessage).not.toHaveBeenCalled();
    expect(glpiClient.createTicket).not.toHaveBeenCalled();
    expect(glpiClient.addFollowUp).toHaveBeenCalledTimes(1);
    expect(messageRepository.updates[0]?.conversationId).toBe('conversation-existing');
  });

  it('ignores stale interactive routing button on an open conversation and appends follow-up', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    conversationRepository.reusableConversation = {
      id: 'conversation-existing',
      phoneE164: '+5511999999999',
      contactId: 'contact-1',
      glpiTicketId: 654,
      queueId: 5,
      status: 'open',
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const routing = new FakeRoutingRepository();
    routing.options = sampleRoutingOptions;
    const meta = {
      sendTextMessage: vi.fn().mockResolvedValue({}),
      sendReplyButtons: vi.fn().mockResolvedValue({}),
    };
    const contactResolutionService = { resolve: vi.fn().mockResolvedValue(resolvedContact) };
    const glpiClient = {
      createTicket: vi.fn(),
      addFollowUp: vi.fn().mockResolvedValue(998),
      getTicketStatus: vi.fn().mockResolvedValue('open'),
    };

    const interactivePayload = structuredClone(basePayload) as typeof basePayload;
    interactivePayload.entry[0].changes[0].value.messages[0] = {
      id: 'wamid.stale-button',
      from: '5511999999999',
      type: 'interactive',
      interactive: {
        type: 'button_reply',
        button_reply: {
          id: 'suporte',
          title: 'Suporte',
        },
      },
    } as never;

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
      { routing, meta },
    );

    const result = await service.process(interactivePayload);

    expect(result.results[0]?.outcome).toBe('processed');
    expect(glpiClient.createTicket).not.toHaveBeenCalled();
    expect(meta.sendReplyButtons).not.toHaveBeenCalled();
    expect(meta.sendTextMessage).not.toHaveBeenCalled();
    expect(glpiClient.addFollowUp).toHaveBeenCalledWith({
      ticketId: 654,
      content: expect.stringContaining('suporte'),
    });
  });

  it('ignores business-hours blocking for an already open conversation', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    conversationRepository.reusableConversation = {
      id: 'conversation-existing',
      phoneE164: '+5511999999999',
      contactId: 'contact-1',
      glpiTicketId: 654,
      queueId: null,
      status: 'open',
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const schedule = new FakeScheduleService();
    schedule.open = false;
    const meta = { sendTextMessage: vi.fn().mockResolvedValue({}) };
    const contactResolutionService = {
      resolve: vi.fn().mockResolvedValue(resolvedContact),
    };
    const glpiClient = {
      createTicket: vi.fn(),
      addFollowUp: vi.fn().mockResolvedValue(998),
      getTicketStatus: vi.fn().mockResolvedValue('open'),
    };

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
      { schedule, meta },
    );

    const result = await service.process(basePayload);

    expect(result.results).toEqual([{ messageId: 'wamid.123', outcome: 'processed' }]);
    expect(schedule.checked).toBe(0);
    expect(meta.sendTextMessage).not.toHaveBeenCalled();
    expect(glpiClient.addFollowUp).toHaveBeenCalledTimes(1);
    expect(messageRepository.updates[0]?.conversationId).toBe('conversation-existing');
  });

  it('sends conversation_closed_message for a closed conversation with a closed GLPI ticket and keeps creating a new ticket', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    conversationRepository.latestClosedConversation = {
      id: 'conversation-closed',
      phoneE164: '+5511999999999',
      contactId: 'contact-1',
      glpiTicketId: 654,
      queueId: null,
      status: 'closed',
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const meta = { sendTextMessage: vi.fn().mockResolvedValue({}) };
    const contactResolutionService = {
      resolve: vi.fn().mockResolvedValue(resolvedContact),
    };
    const glpiClient = {
      createTicket: vi.fn().mockResolvedValue(987),
      addFollowUp: vi.fn(),
      getTicketStatus: vi.fn().mockResolvedValue('closed'),
    };
    const entityMemory = makeEntityMemoryRepository();

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
      { meta, entityMemory },
    );

    const result = await service.process(basePayload);

    expect(result.results).toEqual([{ messageId: 'wamid.123', outcome: 'processed' }]);
    expect(meta.sendTextMessage).toHaveBeenCalledTimes(1);
    expect(meta.sendTextMessage.mock.calls[0]?.[0].body).toBe(
      'Esta conversa esta encerrada. Inicie um novo atendimento.',
    );
    expect(glpiClient.createTicket).toHaveBeenCalledTimes(1);
    expect(conversationRepository.createdCount).toBe(1);
    expect(conversationRepository.lastCreateInput?.glpiTicketId).toBe(987);
    expect(messageRepository.updates[0]?.conversationId).toBe('conversation-1');
  });

  it('falls back for closed conversation message and still sends the routing menu for a new flow', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    conversationRepository.latestClosedConversation = {
      id: 'conversation-closed',
      phoneE164: '+5511999999999',
      contactId: 'contact-1',
      glpiTicketId: 654,
      queueId: null,
      status: 'closed',
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const routing = new FakeRoutingRepository();
    routing.options = sampleRoutingOptions;
    const settings = new FakeSettingsService();
    settings.messages.delete('conversation_closed_message');
    const meta = { sendTextMessage: vi.fn().mockResolvedValue({}) };
    const contactResolutionService = {
      resolve: vi.fn().mockResolvedValue(resolvedContact),
    };
    const glpiClient = {
      createTicket: vi.fn(),
      addFollowUp: vi.fn(),
      getTicketStatus: vi.fn().mockResolvedValue('closed'),
    };

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
      { routing, settings, meta },
    );

    const result = await service.process(basePayload);

    expect(result.results).toEqual([{ messageId: 'wamid.123', outcome: 'processed' }]);
    expect(glpiClient.createTicket).not.toHaveBeenCalled();
    expect(meta.sendTextMessage).toHaveBeenCalledTimes(2);
    expect(meta.sendTextMessage.mock.calls[0]?.[0].body).toBe(
      'Esta conversa esta encerrada. Inicie um novo atendimento.',
    );
    expect(meta.sendTextMessage.mock.calls[1]?.[0].body).toContain('1 - Suporte');
    expect(conversationRepository.lastCreateInput?.status).toBe('awaiting_queue_selection');
  });

  it('does not create a new ticket after a closed ticket when the contact has no entity memory', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    conversationRepository.latestClosedConversation = {
      id: 'conversation-closed',
      phoneE164: '+5511999999999',
      contactId: 'contact-1',
      glpiTicketId: 654,
      queueId: null,
      status: 'closed',
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const meta = { sendTextMessage: vi.fn().mockResolvedValue({}) };
    const contactResolutionService = {
      resolve: vi.fn().mockResolvedValue(resolvedContact),
    };
    const glpiClient = {
      createTicket: vi.fn().mockResolvedValue(987),
      addFollowUp: vi.fn(),
      getTicketStatus: vi.fn().mockResolvedValue('closed'),
    };

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
      { meta },
    );

    const result = await service.process(basePayload);

    expect(result.results).toEqual([{ messageId: 'wamid.123', outcome: 'processed' }]);
    expect(glpiClient.createTicket).not.toHaveBeenCalled();
    expect(conversationRepository.lastCreateInput?.status).toBe('awaiting_entity_selection');
    expect(conversationRepository.updatedQueuesAndStatuses[0]).toEqual({
      conversationId: 'conversation-1',
      queueId: null,
      status: 'awaiting_entity_selection',
    });
    expect(meta.sendTextMessage.mock.calls[1]?.[0].body).toBe('Recebemos as suas informações, em breve um de nossos técnicos irá seguir com o atendimento.');
  });

  it('creates a ticket and links it to an existing conversation without glpi_ticket_id', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    conversationRepository.reusableConversation = {
      id: 'conv-pending',
      phoneE164: '+5511999999999',
      contactId: 'contact-1',
      glpiTicketId: null,
      queueId: null,
      status: 'open',
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const contactResolutionService = {
      resolve: vi.fn().mockResolvedValue(resolvedContact),
    };
    const glpiClient = {
      createTicket: vi.fn().mockResolvedValue(777),
      addFollowUp: vi.fn(),
    };
    const entityMemory = makeEntityMemoryRepository();

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
      { entityMemory },
    );

    const result = await service.process(basePayload);

    expect(result.results).toEqual([{ messageId: 'wamid.123', outcome: 'processed' }]);
    expect(glpiClient.createTicket).toHaveBeenCalledTimes(1);
    expect(glpiClient.createTicket).toHaveBeenCalledWith(expect.objectContaining({
      entitiesId: 321,
    }));
    expect(conversationRepository.createdCount).toBe(0);
    expect(conversationRepository.linkedTickets).toEqual([
      expect.objectContaining({ conversationId: 'conv-pending', ticketId: 777 }),
    ]);
    expect(conversationRepository.touchedConversationIds).toContain('conv-pending');
    expect(messageRepository.updates[0]?.conversationId).toBe('conv-pending');
    expect(messageRepository.updates[0]?.processingStatus).toBe('processed');
    expect(messageRepository.updates[0]?.glpiSyncStatus).toBe('synced');
  });

  it('does not link a ticket to an active conversation without entity memory', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    conversationRepository.reusableConversation = {
      id: 'conv-pending',
      phoneE164: '+5511999999999',
      contactId: 'contact-1',
      glpiTicketId: null,
      queueId: null,
      status: 'open',
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const meta = { sendTextMessage: vi.fn().mockResolvedValue({}) };
    const contactResolutionService = {
      resolve: vi.fn().mockResolvedValue(resolvedContact),
    };
    const glpiClient = {
      createTicket: vi.fn().mockResolvedValue(777),
      addFollowUp: vi.fn(),
    };

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
      { meta },
    );

    const result = await service.process(basePayload);

    expect(result.results).toEqual([{ messageId: 'wamid.123', outcome: 'processed' }]);
    expect(glpiClient.createTicket).not.toHaveBeenCalled();
    expect(conversationRepository.linkedTickets).toEqual([]);
    expect(conversationRepository.updatedQueuesAndStatuses[0]).toEqual({
      conversationId: 'conv-pending',
      queueId: null,
      status: 'awaiting_entity_selection',
    });
    expect(meta.sendTextMessage.mock.calls[0]?.[0].body).toBe('Recebemos as suas informações, em breve um de nossos técnicos irá seguir com o atendimento.');
  });

  it('keeps awaiting_entity_selection without repeating final confirmation when routing options are empty', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    conversationRepository.reusableConversation = {
      id: 'conv-awaiting-entity',
      phoneE164: '+5511999999999',
      contactId: 'contact-1',
      glpiTicketId: null,
      queueId: 5,
      status: 'awaiting_entity_selection',
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const routing = new FakeRoutingRepository();
    routing.options = [];
    const meta = { sendTextMessage: vi.fn().mockResolvedValue({}) };
    const contactResolutionService = {
      resolve: vi.fn().mockResolvedValue(resolvedContact),
    };
    const glpiClient = {
      createTicket: vi.fn().mockResolvedValue(777),
      addFollowUp: vi.fn(),
    };

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
      { routing, meta },
    );

    const result = await service.process(basePayload);

    expect(result.results).toEqual([{ messageId: 'wamid.123', outcome: 'processed' }]);
    expect(glpiClient.createTicket).not.toHaveBeenCalled();
    expect(conversationRepository.updatedQueuesAndStatuses).toEqual([]);
    expect(meta.sendTextMessage).not.toHaveBeenCalled();
    expect(messageRepository.updates[0]).toEqual({
      messageId: 'wamid.123',
      conversationId: 'conv-awaiting-entity',
      processingStatus: 'processed',
      glpiSyncStatus: 'synced',
    });
  });

  it('keeps awaiting_entity_selection without repeating final confirmation when routing options exist', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    conversationRepository.reusableConversation = {
      id: 'conv-awaiting-entity',
      phoneE164: '+5511999999999',
      contactId: 'contact-1',
      glpiTicketId: null,
      queueId: 5,
      status: 'awaiting_entity_selection',
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const routing = new FakeRoutingRepository();
    routing.options = sampleRoutingOptions;
    const meta = {
      sendTextMessage: vi.fn().mockResolvedValue({}),
      sendReplyButtons: vi.fn().mockResolvedValue({}),
    };
    const contactResolutionService = {
      resolve: vi.fn().mockResolvedValue(resolvedContact),
    };
    const glpiClient = {
      createTicket: vi.fn().mockResolvedValue(777),
      addFollowUp: vi.fn(),
    };

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
      { routing, meta },
    );

    const result = await service.process(basePayload);

    expect(result.results).toEqual([{ messageId: 'wamid.123', outcome: 'processed' }]);
    expect(glpiClient.createTicket).not.toHaveBeenCalled();
    expect(conversationRepository.createdCount).toBe(0);
    expect(conversationRepository.updatedQueuesAndStatuses).toEqual([]);
    expect(meta.sendReplyButtons).not.toHaveBeenCalled();
    expect(meta.sendTextMessage).not.toHaveBeenCalled();
  });

  it('normalizes a completed contact profile collection state to awaiting_entity_selection', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    conversationRepository.reusableConversation = {
      id: 'conv-collecting-complete',
      phoneE164: '+5511999999999',
      contactId: 'contact-1',
      glpiTicketId: null,
      queueId: 5,
      profileCollectionState: { step: 'complete' },
      status: 'collecting_contact_profile',
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const routing = new FakeRoutingRepository();
    routing.options = sampleRoutingOptions;
    const meta = {
      sendTextMessage: vi.fn().mockResolvedValue({}),
      sendReplyButtons: vi.fn().mockResolvedValue({}),
    };
    const contactResolutionService = {
      resolve: vi.fn().mockResolvedValue(resolvedContact),
    };
    const glpiClient = {
      createTicket: vi.fn().mockResolvedValue(777),
      addFollowUp: vi.fn(),
    };

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
      { routing, meta },
    );

    const result = await service.process(basePayload);

    expect(result.results).toEqual([{ messageId: 'wamid.123', outcome: 'processed' }]);
    expect(glpiClient.createTicket).not.toHaveBeenCalled();
    expect(conversationRepository.updatedQueuesAndStatuses).toEqual([{
      conversationId: 'conv-collecting-complete',
      queueId: 5,
      status: 'awaiting_entity_selection',
    }]);
    expect(meta.sendReplyButtons).not.toHaveBeenCalled();
    expect(meta.sendTextMessage.mock.calls[0]?.[0].body).toBe('Recebemos as suas informações, em breve um de nossos técnicos irá seguir com o atendimento.');
  });

  it('creates a ticket from a completed contact profile state when active entity memory exists', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    conversationRepository.reusableConversation = {
      id: 'conv-collecting-complete-memory',
      phoneE164: '+5511999999999',
      contactId: 'contact-1',
      glpiTicketId: null,
      queueId: 5,
      profileCollectionState: {
        step: 'complete',
        queue_label: 'Suporte',
        company_name_raw: 'Empresa',
        requester_name: 'Maria',
        last_equipment_tag: '2022',
        reason: 'Impressora parada',
      },
      status: 'collecting_contact_profile',
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const routing = new FakeRoutingRepository();
    routing.options = sampleRoutingOptions;
    const contactProfile = new FakeContactProfileService();
    contactProfile.collectionEnabled = true;
    contactProfile.profile = {
      phone_e164: '+5511999999999',
      requester_name: 'Maria',
      company_name_raw: 'Empresa',
      last_equipment_tag: '2022',
      equipment_tag_unknown: false,
      last_problem_summary: 'Impressora parada',
      profile_status: 'complete',
      profile_source: 'whatsapp',
      confirmation_count: 1,
      last_confirmed_at: new Date().toISOString(),
    };
    const entityMemory = makeEntityMemoryRepository(
      makeEntityMemory({ id: 'mem-1', glpiEntityId: 124, glpiEntityName: 'Ética > Avulsos > Arizona' }),
    );
    const meta = { sendTextMessage: vi.fn().mockResolvedValue({}) };
    const contactResolutionService = { resolve: vi.fn().mockResolvedValue(resolvedContact) };
    const glpiClient = { createTicket: vi.fn().mockResolvedValue(2112319300), addFollowUp: vi.fn() };

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
      { routing, meta, contactProfile, entityMemory },
    );

    const result = await service.process(basePayload);

    expect(result.results).toEqual([{ messageId: 'wamid.123', outcome: 'processed' }]);
    expect(conversationRepository.updatedQueuesAndStatuses).toEqual([]);
    expect(glpiClient.createTicket).toHaveBeenCalledWith(expect.objectContaining({
      entitiesId: 124,
    }), expect.anything());
    expect(conversationRepository.linkedTickets[0]).toEqual({
      conversationId: 'conv-collecting-complete-memory',
      ticketId: 2112319300,
      queueId: 5,
      glpiEntityId: 124,
      glpiEntityName: 'Ética > Avulsos > Arizona',
    });
    expect(meta.sendTextMessage.mock.calls[0]?.[0].body).toContain('#2112319300');
  });

  it('marks the message failed when follow-up creation fails', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    conversationRepository.reusableConversation = {
      id: 'conversation-existing',
      phoneE164: '+5511999999999',
      contactId: 'contact-1',
      glpiTicketId: 654,
      queueId: null,
      status: 'open',
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const contactResolutionService = {
      resolve: vi.fn().mockResolvedValue(resolvedContact),
    };
    const glpiClient = {
      createTicket: vi.fn(),
      addFollowUp: vi.fn().mockRejectedValue(new Error('follow-up failed')),
      getTicketStatus: vi.fn().mockResolvedValue('open'),
    };

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
    );

    const result = await service.process(basePayload);

    expect(result.results).toEqual([{ messageId: 'wamid.123', outcome: 'failed' }]);
    expect(glpiClient.createTicket).not.toHaveBeenCalled();
    expect(messageRepository.updates[0]).toEqual({
      messageId: 'wamid.123',
      conversationId: 'conversation-existing',
      processingStatus: 'failed',
      glpiSyncStatus: 'error',
    });
    expect(webhookEventRepository.updates[0]?.processingStatus).toBe('failed');
  });

  it('marks the message failed when ticket creation fails in standard flow', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    const contactResolutionService = {
      resolve: vi.fn().mockResolvedValue(resolvedContact),
    };
    const glpiClient = {
      createTicket: vi.fn().mockRejectedValue(new Error('GLPI down')),
      addFollowUp: vi.fn(),
    };
    const entityMemory = makeEntityMemoryRepository();

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
      { entityMemory },
    );

    const result = await service.process(basePayload);

    expect(result.results).toEqual([{ messageId: 'wamid.123', outcome: 'failed' }]);
    expect(messageRepository.updates[0]).toEqual({
      messageId: 'wamid.123',
      processingStatus: 'failed',
      glpiSyncStatus: 'error',
    });
    expect(webhookEventRepository.updates[0]?.processingStatus).toBe('failed');
  });

  it('creates a ticket on first message and a follow-up on second message from same phone', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    const contactResolutionService = {
      resolve: vi.fn().mockResolvedValue(resolvedContact),
    };
    const glpiClient = {
      createTicket: vi.fn().mockResolvedValue(321),
      addFollowUp: vi.fn().mockResolvedValue(999),
      getTicketStatus: vi.fn().mockResolvedValue('open'),
    };
    const entityMemory = makeEntityMemoryRepository();

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
      { entityMemory },
    );

    const payload1 = structuredClone(basePayload) as typeof basePayload;
    payload1.entry[0].changes[0].value.messages[0].id = 'wamid.first';

    const payload2 = structuredClone(basePayload) as typeof basePayload;
    payload2.entry[0].changes[0].value.messages[0].id = 'wamid.second';
    payload2.entry[0].changes[0].value.messages[0].text.body = 'second msg';

    await service.process(payload1);

    // simulate continuity persisted after first run
    conversationRepository.reusableConversation = {
      id: 'conversation-existing',
      phoneE164: '+5511999999999',
      contactId: 'contact-1',
      glpiTicketId: 321,
      queueId: null,
      status: 'open',
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await service.process(payload2);

    expect(glpiClient.createTicket).toHaveBeenCalledTimes(1);
    expect(glpiClient.addFollowUp).toHaveBeenCalledTimes(1);
    expect(glpiClient.addFollowUp).toHaveBeenCalledWith({
      ticketId: 321,
      content: expect.stringContaining('second msg'),
    });
  });

  it('with active routing options, first contact sends menu and does not create a GLPI ticket', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    const routing = new FakeRoutingRepository();
    routing.options = sampleRoutingOptions;
    const meta = { sendTextMessage: vi.fn().mockResolvedValue({}) };
    const contactResolutionService = { resolve: vi.fn().mockResolvedValue(resolvedContact) };
    const glpiClient = { createTicket: vi.fn().mockResolvedValue(999), addFollowUp: vi.fn() };
    const audit = {
      recordAuditEventFireAndForget: vi.fn(),
    } as unknown as AuditService;

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
      { routing, meta, audit },
    );

    const result = await service.process(basePayload);

    expect(result.results[0]?.outcome).toBe('processed');
    expect(glpiClient.createTicket).not.toHaveBeenCalled();
    expect(conversationRepository.createdCount).toBe(1);
    expect(conversationRepository.lastCreateInput?.status).toBe('awaiting_queue_selection');
    expect(conversationRepository.lastCreateInput?.glpiTicketId).toBeNull();
    expect(meta.sendTextMessage).toHaveBeenCalledTimes(1);
    expect(meta.sendTextMessage.mock.calls[0]?.[0].body).toContain('1 - Suporte');
    expect(meta.sendTextMessage.mock.calls[0]?.[0].body).toContain('2 - Financeiro');
    expect(audit.recordAuditEventFireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'ROUTING_MENU_SENT',
        status: 'success',
        severity: 'info',
        conversationId: 'conversation-1',
        payload: expect.objectContaining({
          context: 'initial_menu',
          options_count: 2,
          delivery_mode: 'text',
          option_keys: ['suporte', 'fin'],
        }),
      }),
    );
  });

  it('with contact profile enabled and no selected queue, still sends routing menu before collecting profile', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    const routing = new FakeRoutingRepository();
    routing.options = sampleRoutingOptions;
    const contactProfile = new FakeContactProfileService();
    contactProfile.collectionEnabled = true;
    const meta = { sendTextMessage: vi.fn().mockResolvedValue({}) };
    const contactResolutionService = { resolve: vi.fn().mockResolvedValue(resolvedContact) };
    const glpiClient = { createTicket: vi.fn().mockResolvedValue(999), addFollowUp: vi.fn() };

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
      { routing, meta, contactProfile },
    );

    const result = await service.process(basePayload);

    expect(result.results[0]?.outcome).toBe('processed');
    expect(glpiClient.createTicket).not.toHaveBeenCalled();
    expect(conversationRepository.lastCreateInput?.status).toBe('awaiting_queue_selection');
    expect(meta.sendTextMessage).toHaveBeenCalledTimes(1);
    expect(meta.sendTextMessage.mock.calls[0]?.[0].body).toContain('1 - Suporte');
    expect(meta.sendTextMessage.mock.calls[0]?.[0].body).not.toContain(contactProfile.prompt);
  });

  it('with contact profile enabled, selected queue starts profile collection and does not create ticket yet', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    const contactResolutionService = { resolve: vi.fn().mockResolvedValue(resolvedContact) };
    conversationRepository.reusableConversation = {
      id: 'conv-awaiting-profile',
      phoneE164: '+5511999999999',
      contactId: 'contact-1',
      glpiTicketId: null,
      queueId: null,
      status: 'awaiting_queue_selection',
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const routing = new FakeRoutingRepository();
    routing.options = sampleRoutingOptions;
    const contactProfile = new FakeContactProfileService();
    contactProfile.collectionEnabled = true;
    const entityMemory = makeEntityMemoryRepository(
      makeEntityMemory({ id: 'memory-1', glpiEntityId: 42, glpiEntityName: 'Cliente' }),
    );
    const meta = { sendTextMessage: vi.fn().mockResolvedValue({}) };
    const glpiClient = { createTicket: vi.fn(), addFollowUp: vi.fn() };

    const digitOnePayload = structuredClone(basePayload) as typeof basePayload;
    digitOnePayload.entry[0].changes[0].value.messages[0].text.body = '1';

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
      { routing, meta, contactProfile, entityMemory },
    );

    const result = await service.process(digitOnePayload);

    expect(result.results[0]?.outcome).toBe('processed');
    expect(glpiClient.createTicket).not.toHaveBeenCalled();
    expect(conversationRepository.updatedQueuesAndStatuses).toEqual([
      { conversationId: 'conv-awaiting-profile', queueId: 5, status: 'collecting_contact_profile' },
    ]);
    expect(meta.sendTextMessage).toHaveBeenCalledWith({
      to: '5511999999999',
      body: `${contactProfile.prompt}\n\nSe quiser encerrar este atendimento, digite cancelar a qualquer momento.`,
    });
  });

  it('with contact profile enabled and existing profile, asks confirmation before ticket creation', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    const contactResolutionService = { resolve: vi.fn().mockResolvedValue(resolvedContact) };
    conversationRepository.reusableConversation = {
      id: 'conv-existing-profile',
      phoneE164: '+5511999999999',
      contactId: 'contact-1',
      glpiTicketId: null,
      queueId: null,
      status: 'awaiting_queue_selection',
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const routing = new FakeRoutingRepository();
    routing.options = sampleRoutingOptions;
    const contactProfile = new FakeContactProfileService();
    contactProfile.collectionEnabled = true;
    contactProfile.profile = {
      phone_e164: '+5511999999999',
      requester_name: 'Maria',
      company_name_raw: 'Empresa',
      last_equipment_tag: '2022',
      equipment_tag_unknown: false,
      last_problem_summary: 'Internet lenta',
      profile_status: 'complete',
      profile_source: 'whatsapp',
      confirmation_count: 1,
      last_confirmed_at: new Date().toISOString(),
    };
    const meta = { sendTextMessage: vi.fn().mockResolvedValue({}) };
    const glpiClient = { createTicket: vi.fn().mockResolvedValue(902), addFollowUp: vi.fn() };
    const digitOnePayload = structuredClone(basePayload) as typeof basePayload;
    digitOnePayload.entry[0].changes[0].value.messages[0].text.body = '1';

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
      { routing, meta, contactProfile },
    );

    const result = await service.process(digitOnePayload);

    expect(result.results[0]?.outcome).toBe('processed');
    expect(meta.sendTextMessage.mock.calls[0]?.[0].body).toContain('As informacoes estao corretas');
    expect(glpiClient.createTicket).not.toHaveBeenCalled();
    expect(contactProfile.snapshots).toHaveLength(0);
    expect(conversationRepository.profileStates[0]?.state).toMatchObject({
      step: 'confirming_existing_profile',
      company_name_raw: 'Empresa',
    });
  });

  it('with contact profile enabled and invalid existing tag, starts step-by-step collection instead of confirmation', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    const contactResolutionService = { resolve: vi.fn().mockResolvedValue(resolvedContact) };
    conversationRepository.reusableConversation = {
      id: 'conv-invalid-profile',
      phoneE164: '+5511999999999',
      contactId: 'contact-1',
      glpiTicketId: null,
      queueId: null,
      status: 'awaiting_queue_selection',
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const routing = new FakeRoutingRepository();
    routing.options = sampleRoutingOptions;
    const contactProfile = new FakeContactProfileService();
    contactProfile.collectionEnabled = true;
    contactProfile.profile = {
      phone_e164: '+5511999999999',
      requester_name: 'Maria',
      company_name_raw: 'Empresa',
      last_equipment_tag: '12345',
      equipment_tag_unknown: false,
      last_problem_summary: 'Internet lenta',
      profile_status: 'complete',
      profile_source: 'whatsapp',
      confirmation_count: 1,
      last_confirmed_at: new Date().toISOString(),
    };
    const meta = { sendTextMessage: vi.fn().mockResolvedValue({}) };
    const glpiClient = { createTicket: vi.fn().mockResolvedValue(902), addFollowUp: vi.fn() };
    const digitOnePayload = structuredClone(basePayload) as typeof basePayload;
    digitOnePayload.entry[0].changes[0].value.messages[0].text.body = '1';

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
      { routing, meta, contactProfile },
    );

    const result = await service.process(digitOnePayload);

    expect(result.results[0]?.outcome).toBe('processed');
    expect(meta.sendTextMessage.mock.calls[0]?.[0].body).toBe(
      `${contactProfile.prompt}\n\nSe quiser encerrar este atendimento, digite cancelar a qualquer momento.`,
    );
    expect(glpiClient.createTicket).not.toHaveBeenCalled();
    expect(conversationRepository.profileStates[0]?.state).toMatchObject({
      step: 'asking_company',
      queue_label: 'Suporte',
    });
  });

  it('sends the TAG_UNKNOWN button when the profile flow asks for equipment tag', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    const contactResolutionService = { resolve: vi.fn().mockResolvedValue(resolvedContact) };
    conversationRepository.reusableConversation = {
      id: 'conv-asking-name',
      phoneE164: '+5511999999999',
      contactId: 'contact-1',
      glpiTicketId: null,
      queueId: 5,
      profileCollectionState: {
        step: 'asking_name',
        queue_label: 'Suporte',
        company_name_raw: 'Empresa',
      },
      status: 'collecting_contact_profile',
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const routing = new FakeRoutingRepository();
    routing.options = sampleRoutingOptions;
    const contactProfile = new FakeContactProfileService();
    contactProfile.collectionEnabled = true;
    const meta = {
      sendTextMessage: vi.fn().mockResolvedValue({}),
      sendReplyButtons: vi.fn().mockResolvedValue({}),
    };
    const glpiClient = { createTicket: vi.fn().mockResolvedValue(902), addFollowUp: vi.fn() };
    const namePayload = structuredClone(basePayload) as typeof basePayload;
    namePayload.entry[0].changes[0].value.messages[0].text.body = 'Bruno Baumel';

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
      { routing, meta, contactProfile },
    );

    const result = await service.process(namePayload);

    expect(result.results[0]?.outcome).toBe('processed');
    expect(glpiClient.createTicket).not.toHaveBeenCalled();
    expect(meta.sendReplyButtons).toHaveBeenCalledWith(
      '5511999999999',
      expect.stringContaining('4 números'),
      [{ id: 'TAG_UNKNOWN', title: 'Não sei' }],
    );
    expect(meta.sendTextMessage).not.toHaveBeenCalled();
    expect(conversationRepository.profileStates[0]?.state).toMatchObject({
      step: 'asking_tag',
      requester_name: 'Bruno Baumel',
    });
  });

  it('treats legacy default entity mode as manual selection when the contact has no memory', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    const contactResolutionService = { resolve: vi.fn().mockResolvedValue(resolvedContact) };
    conversationRepository.reusableConversation = {
      id: 'conv-collecting-profile',
      phoneE164: '+5511999999999',
      contactId: 'contact-1',
      glpiTicketId: null,
      queueId: 5,
      profileCollectionState: {
        step: 'asking_reason',
        queue_label: 'Suporte',
        company_name_raw: 'Empresa',
        requester_name: 'Maria',
        last_equipment_tag: '2022',
        equipment_tag_unknown: false,
      },
      status: 'collecting_contact_profile',
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const routing = new FakeRoutingRepository();
    routing.options = sampleRoutingOptions;
    const contactProfile = new FakeContactProfileService();
    contactProfile.collectionEnabled = true;
    const entityResolution = new FakeContactEntityResolutionService();
    entityResolution.mode = 'use_default_entity';
    const meta = { sendTextMessage: vi.fn().mockResolvedValue({}) };
    const glpiClient = { createTicket: vi.fn().mockResolvedValue(901), addFollowUp: vi.fn() };

    const profilePayload = structuredClone(basePayload) as typeof basePayload;
    profilePayload.entry[0].changes[0].value.messages[0].text.body = 'Impressora parada';

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
      { routing, meta, contactProfile, entityResolution },
    );

    const result = await service.process(profilePayload);

    expect(result.results[0]?.outcome).toBe('processed');
    expect(contactProfile.savedProfiles[0]).toMatchObject({
      company_name_raw: 'Empresa',
      requester_name: 'Maria',
      last_equipment_tag: '2022',
      last_problem_summary: 'Impressora parada',
    });
    expect(contactProfile.snapshots[0]).toEqual(expect.objectContaining({
      conversationId: 'conv-collecting-profile',
      contactId: 'contact-1',
      phoneE164: '+5511999999999',
    }));
    expect(glpiClient.createTicket).not.toHaveBeenCalled();
    expect(conversationRepository.linkedTickets).toEqual([]);
    expect(conversationRepository.updatedQueuesAndStatuses[0]).toEqual({
      conversationId: 'conv-collecting-profile',
      queueId: 5,
      status: 'awaiting_entity_selection',
    });
  });

  it('with contact profile enabled, complete profile creates ticket automatically when memory has an entity', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    const contactResolutionService = { resolve: vi.fn().mockResolvedValue(resolvedContact) };
    conversationRepository.reusableConversation = {
      id: 'conv-collecting-memory',
      phoneE164: '+5511999999999',
      contactId: 'contact-1',
      glpiTicketId: null,
      queueId: 5,
      profileCollectionState: {
        step: 'asking_reason',
        queue_label: 'Suporte',
        company_name_raw: 'Empresa',
        requester_name: 'Maria',
        last_equipment_tag: '2022',
        equipment_tag_unknown: false,
      },
      status: 'collecting_contact_profile',
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const routing = new FakeRoutingRepository();
    routing.options = sampleRoutingOptions;
    const contactProfile = new FakeContactProfileService();
    contactProfile.collectionEnabled = true;
    const entityMemory = makeEntityMemoryRepository(
      makeEntityMemory({ id: 'mem-1', glpiEntityId: 321, glpiEntityName: 'Entidade memorizada' }),
    );
    const meta = { sendTextMessage: vi.fn().mockResolvedValue({}) };
    const glpiClient = { createTicket: vi.fn().mockResolvedValue(901), addFollowUp: vi.fn() };

    const profilePayload = structuredClone(basePayload) as typeof basePayload;
    profilePayload.entry[0].changes[0].value.messages[0].text.body = 'Impressora parada';

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
      { routing, meta, contactProfile, entityMemory },
    );

    const result = await service.process(profilePayload);

    expect(result.results[0]?.outcome).toBe('processed');
    expect(glpiClient.createTicket).toHaveBeenCalledWith(expect.objectContaining({
      entitiesId: 321,
    }), expect.anything());
    expect(conversationRepository.linkedTickets[0]).toEqual({
      conversationId: 'conv-collecting-memory',
      ticketId: 901,
      queueId: 5,
      glpiEntityId: 321,
      glpiEntityName: 'Entidade memorizada',
    });
  });

  it('with contact profile enabled and defer_until_known, complete profile waits for entity without creating ticket', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    const contactResolutionService = { resolve: vi.fn().mockResolvedValue(resolvedContact) };
    conversationRepository.reusableConversation = {
      id: 'conv-collecting-defer',
      phoneE164: '+5511999999999',
      contactId: 'contact-1',
      glpiTicketId: null,
      queueId: 5,
      profileCollectionState: {
        step: 'asking_reason',
        queue_label: 'Suporte',
        company_name_raw: 'Empresa',
        requester_name: 'Maria',
        last_equipment_tag: null,
        equipment_tag_unknown: true,
      },
      status: 'collecting_contact_profile',
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const routing = new FakeRoutingRepository();
    routing.options = sampleRoutingOptions;
    const contactProfile = new FakeContactProfileService();
    contactProfile.collectionEnabled = true;
    const entityResolution = new FakeContactEntityResolutionService();
    entityResolution.mode = 'defer_until_known';
    const meta = { sendTextMessage: vi.fn().mockResolvedValue({}) };
    const audit = {
      recordAuditEventFireAndForget: vi.fn(),
    } as unknown as AuditService;
    const glpiClient = { createTicket: vi.fn(), addFollowUp: vi.fn() };

    const profilePayload = structuredClone(basePayload) as typeof basePayload;
    profilePayload.entry[0].changes[0].value.messages[0].text.body = 'Internet lenta';

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
      { routing, meta, contactProfile, entityResolution, audit },
    );

    const result = await service.process(profilePayload);

    expect(result.results[0]?.outcome).toBe('processed');
    expect(contactProfile.snapshots).toHaveLength(1);
    expect(glpiClient.createTicket).not.toHaveBeenCalled();
    expect(conversationRepository.updatedQueuesAndStatuses).toEqual([
      { conversationId: 'conv-collecting-defer', queueId: 5, status: 'awaiting_entity_selection' },
    ]);
    expect(audit.recordAuditEventFireAndForget).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conv-collecting-defer',
      messageId: 'wamid.123',
      eventType: 'TICKET_CREATION_DEFERRED_ENTITY_PENDING',
      status: 'pending',
      payload: expect.objectContaining({
        reason: 'entity_selection_required',
        queue_id: 5,
      }),
    }));
  });

  it('persists a summary once and suppresses repeated final confirmation while entity selection is pending', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    const contactResolutionService = { resolve: vi.fn().mockResolvedValue(resolvedContact) };
    conversationRepository.reusableConversation = {
      id: 'conv-summary-once',
      phoneE164: '+5511999999999',
      contactId: 'contact-1',
      glpiTicketId: null,
      queueId: 5,
      profileCollectionState: {
        step: 'asking_reason',
        queue_label: 'Suporte',
        company_name_raw: 'Empresa',
        requester_name: 'Maria',
        last_equipment_tag: '2022',
        equipment_tag_unknown: false,
      },
      status: 'collecting_contact_profile',
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const routing = new FakeRoutingRepository();
    routing.options = sampleRoutingOptions;
    const contactProfile = new FakeContactProfileService();
    contactProfile.collectionEnabled = true;
    const meta = { sendTextMessage: vi.fn().mockResolvedValue({}) };
    const audit = {
      recordAuditEventFireAndForget: vi.fn(),
    } as unknown as AuditService;
    const glpiClient = { createTicket: vi.fn(), addFollowUp: vi.fn() };

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
      { routing, meta, contactProfile, audit },
    );

    const summaryPayload = structuredClone(basePayload) as typeof basePayload;
    summaryPayload.entry[0].changes[0].value.messages[0].id = 'wamid.summary-once';
    summaryPayload.entry[0].changes[0].value.messages[0].text.body = 'Impressora parada';
    const repeatedPayload = structuredClone(basePayload) as typeof basePayload;
    repeatedPayload.entry[0].changes[0].value.messages[0].id = 'wamid.summary-followup';
    repeatedPayload.entry[0].changes[0].value.messages[0].text.body = 'Tem alguma novidade?';

    await service.process(summaryPayload);
    await service.process(repeatedPayload);

    expect(contactProfile.savedProfiles).toHaveLength(1);
    expect(contactProfile.savedProfiles[0]?.last_problem_summary).toBe('Impressora parada');
    expect(contactProfile.snapshots).toHaveLength(1);
    expect(conversationRepository.updatedQueuesAndStatuses).toEqual([
      { conversationId: 'conv-summary-once', queueId: 5, status: 'awaiting_entity_selection' },
    ]);
    expect(glpiClient.createTicket).not.toHaveBeenCalled();
    expect(meta.sendTextMessage).toHaveBeenCalledTimes(1);
    expect(meta.sendTextMessage).toHaveBeenCalledWith({
      to: '5511999999999',
      body: 'Recebemos as suas informações, em breve um de nossos técnicos irá seguir com o atendimento.',
    });
    expect(audit.recordAuditEventFireAndForget).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'CONTACT_PROFILE_FINAL_CONFIRMATION_SUPPRESSED',
      conversationId: 'conv-summary-once',
      messageId: 'wamid.summary-followup',
      status: 'ignored',
      payload: expect.objectContaining({
        reason: 'entity_selection_already_pending',
      }),
    }));
  });

  it('with contact profile enabled, incomplete profile remains collecting and asks for missing data', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    const contactResolutionService = { resolve: vi.fn().mockResolvedValue(resolvedContact) };
    conversationRepository.reusableConversation = {
      id: 'conv-collecting-incomplete',
      phoneE164: '+5511999999999',
      contactId: 'contact-1',
      glpiTicketId: null,
      queueId: 5,
      profileCollectionState: { step: 'asking_company' },
      status: 'collecting_contact_profile',
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const routing = new FakeRoutingRepository();
    routing.options = sampleRoutingOptions;
    const contactProfile = new FakeContactProfileService();
    contactProfile.collectionEnabled = true;
    contactProfile.profileComplete = false;
    const entityResolution = new FakeContactEntityResolutionService();
    entityResolution.mode = 'defer_until_known';
    const meta = { sendTextMessage: vi.fn().mockResolvedValue({}) };
    const glpiClient = { createTicket: vi.fn(), addFollowUp: vi.fn() };

    const profilePayload = structuredClone(basePayload) as typeof basePayload;
    profilePayload.entry[0].changes[0].value.messages[0].text.body = 'Empresa';

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
      { routing, meta, contactProfile, entityResolution },
    );

    const result = await service.process(profilePayload);

    expect(result.results[0]?.outcome).toBe('processed');
    expect(contactProfile.savedTexts).toEqual([]);
    expect(contactProfile.snapshots).toHaveLength(0);
    expect(conversationRepository.updatedQueuesAndStatuses).toHaveLength(0);
    expect(glpiClient.createTicket).not.toHaveBeenCalled();
    expect(meta.sendTextMessage).toHaveBeenCalledWith({
      to: '5511999999999',
      body: 'Informe seu nome completo.\n\nSe quiser encerrar este atendimento, digite cancelar a qualquer momento.',
    });
  });

  it('blocks media during textual pre-ticket collection before download or attachment', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    const contactResolutionService = { resolve: vi.fn().mockResolvedValue(resolvedContact) };
    conversationRepository.reusableConversation = {
      id: 'conv-collecting-media',
      phoneE164: '+5511999999999',
      contactId: 'contact-1',
      glpiTicketId: null,
      queueId: 5,
      profileCollectionState: { step: 'asking_reason', requester_name: 'Maria' },
      status: 'collecting_contact_profile',
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const contactProfile = new FakeContactProfileService();
    contactProfile.collectionEnabled = true;
    const meta = { sendTextMessage: vi.fn().mockResolvedValue({}) };
    const glpiClient = { createTicket: vi.fn(), addFollowUp: vi.fn() };
    const mediaProcessing = { processMedia: vi.fn() };
    const messageConfiguration = {
      resolveSendPlan: vi.fn().mockResolvedValue({
        eventKey: 'preticket_invalid_input',
        sendType: 'text',
        text: 'Envie texto para continuar.',
        active: true,
        shouldSend: true,
        reason: null,
        templateName: null,
        language: 'pt_BR',
        buttons: [],
        listOptions: [],
      }),
      recordAutomationEvent: vi.fn().mockResolvedValue(undefined),
    };

    const imagePayload = structuredClone(basePayload) as typeof basePayload;
    const message = imagePayload.entry[0].changes[0].value.messages[0] as unknown as Record<string, unknown>;
    delete message.text;
    message.type = 'image';
    message.image = { id: 'media-123', mime_type: 'image/jpeg' };

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
      { meta, contactProfile, mediaProcessing, messageConfiguration },
    );

    const result = await service.process(imagePayload);

    expect(result.results[0]?.outcome).toBe('processed');
    expect(mediaProcessing.processMedia).not.toHaveBeenCalled();
    expect(glpiClient.createTicket).not.toHaveBeenCalled();
    expect(glpiClient.addFollowUp).not.toHaveBeenCalled();
    expect(conversationRepository.profileStates).toEqual([]);
    expect(messageRepository.mediaInfoUpdates).toEqual([]);
    expect(messageRepository.updates[0]).toEqual(expect.objectContaining({
      messageId: 'wamid.123',
      conversationId: 'conv-collecting-media',
      processingStatus: 'processed',
      glpiSyncStatus: 'synced',
    }));
    expect(meta.sendTextMessage).toHaveBeenCalledWith({
      to: '5511999999999',
      body: 'Envie texto para continuar.',
    });
    expect(messageConfiguration.resolveSendPlan).toHaveBeenCalledWith('preticket_invalid_input', {
      windowOpen: true,
      allowTemplateSend: true,
    });
  });

  it('blocks audio during asking_reason before media download', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    const contactResolutionService = { resolve: vi.fn().mockResolvedValue(resolvedContact) };
    conversationRepository.reusableConversation = {
      id: 'conv-collecting-audio',
      phoneE164: '+5511999999999',
      contactId: 'contact-1',
      glpiTicketId: null,
      queueId: 5,
      profileCollectionState: { step: 'asking_reason', requester_name: 'Maria' },
      status: 'collecting_contact_profile',
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const contactProfile = new FakeContactProfileService();
    contactProfile.collectionEnabled = true;
    const meta = { sendTextMessage: vi.fn().mockResolvedValue({}) };
    const glpiClient = { createTicket: vi.fn(), addFollowUp: vi.fn() };
    const mediaProcessing = { processMedia: vi.fn() };
    const messageConfiguration = {
      resolveSendPlan: vi.fn().mockResolvedValue({
        eventKey: 'preticket_invalid_input',
        sendType: 'text',
        text: 'Neste momento preciso que você responda em texto. Envie uma breve descrição do problema. Se quiser encerrar, digite cancelar.',
        active: true,
        shouldSend: true,
        reason: null,
        templateName: null,
        language: 'pt_BR',
        buttons: [],
        listOptions: [],
      }),
      recordAutomationEvent: vi.fn().mockResolvedValue(undefined),
    };

    const audioPayload = structuredClone(basePayload) as typeof basePayload;
    const message = audioPayload.entry[0].changes[0].value.messages[0] as unknown as Record<string, unknown>;
    delete message.text;
    message.type = 'audio';
    message.audio = { id: 'media-audio-123', mime_type: 'audio/ogg' };

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
      { meta, contactProfile, mediaProcessing, messageConfiguration },
    );

    const result = await service.process(audioPayload);

    expect(result.results[0]?.outcome).toBe('processed');
    expect(mediaProcessing.processMedia).not.toHaveBeenCalled();
    expect(glpiClient.createTicket).not.toHaveBeenCalled();
    expect(conversationRepository.profileStates).toEqual([]);
    expect(meta.sendTextMessage).toHaveBeenCalledWith({
      to: '5511999999999',
      body: 'Neste momento preciso que você responda em texto. Envie uma breve descrição do problema. Se quiser encerrar, digite cancelar.',
    });
  });

  it.each([
    ['document', { id: 'media-doc-123', mime_type: 'application/pdf', filename: 'evidencia.pdf' }],
    ['sticker', { id: 'sticker-123', mime_type: 'image/webp' }],
  ])('blocks %s during asking_reason and keeps the pre-ticket state', async (messageType, mediaPayload) => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    const contactResolutionService = { resolve: vi.fn().mockResolvedValue(resolvedContact) };
    conversationRepository.reusableConversation = {
      id: `conv-collecting-${messageType}`,
      phoneE164: '+5511999999999',
      contactId: 'contact-1',
      glpiTicketId: null,
      queueId: 5,
      profileCollectionState: { step: 'asking_reason', requester_name: 'Maria' },
      status: 'collecting_contact_profile',
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const contactProfile = new FakeContactProfileService();
    contactProfile.collectionEnabled = true;
    const meta = { sendTextMessage: vi.fn().mockResolvedValue({}) };
    const glpiClient = { createTicket: vi.fn(), addFollowUp: vi.fn() };
    const mediaProcessing = { processMedia: vi.fn() };

    const payload = structuredClone(basePayload) as typeof basePayload;
    const message = payload.entry[0].changes[0].value.messages[0] as unknown as Record<string, unknown>;
    delete message.text;
    message.type = messageType;
    message[messageType] = mediaPayload;

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
      { meta, contactProfile, mediaProcessing },
    );

    const result = await service.process(payload);

    expect(result.results[0]?.outcome).toBe('processed');
    expect(mediaProcessing.processMedia).not.toHaveBeenCalled();
    expect(glpiClient.createTicket).not.toHaveBeenCalled();
    expect(glpiClient.addFollowUp).not.toHaveBeenCalled();
    expect(conversationRepository.profileStates).toEqual([]);
    expect(messageRepository.mediaInfoUpdates).toEqual([]);
    expect(meta.sendTextMessage).toHaveBeenCalledWith({
      to: '5511999999999',
      body: 'Neste momento preciso que você responda em texto. Envie uma breve descrição do problema. Se quiser encerrar, digite cancelar.',
    });
  });

  it('cancels pre-ticket by explicit user text without creating ticket or CSAT', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    const contactResolutionService = { resolve: vi.fn().mockResolvedValue(resolvedContact) };
    conversationRepository.reusableConversation = {
      id: 'conv-collecting-cancel',
      phoneE164: '+5511999999999',
      contactId: 'contact-1',
      glpiTicketId: null,
      queueId: 5,
      profileCollectionState: { step: 'asking_reason', requester_name: 'Maria' },
      status: 'collecting_contact_profile',
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const contactProfile = new FakeContactProfileService();
    contactProfile.collectionEnabled = true;
    const meta = { sendTextMessage: vi.fn().mockResolvedValue({}) };
    const glpiClient = { createTicket: vi.fn(), addFollowUp: vi.fn() };

    const cancelPayload = structuredClone(basePayload) as typeof basePayload;
    cancelPayload.entry[0].changes[0].value.messages[0].text.body = 'cancelar';

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
      { meta, contactProfile },
    );

    const result = await service.process(cancelPayload);

    expect(result.results[0]?.outcome).toBe('processed');
    expect(glpiClient.createTicket).not.toHaveBeenCalled();
    expect(glpiClient.addFollowUp).not.toHaveBeenCalled();
    expect(conversationRepository.updatedStatuses).toEqual([{
      conversationId: 'conv-collecting-cancel',
      status: 'cancelled',
    }]);
    expect(conversationRepository.profileStates[0]).toEqual(expect.objectContaining({
      conversationId: 'conv-collecting-cancel',
      state: expect.objectContaining({
        close_reason: 'preticket_user_cancelled',
      }),
    }));
    expect(meta.sendTextMessage).toHaveBeenCalledWith({
      to: '5511999999999',
      body: 'Atendimento cancelado. Nenhum chamado foi aberto. Se precisar, inicie um novo atendimento.',
    });
  });

  it('with contact profile enabled and no routing options, first contact collects profile instead of creating ticket directly', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    const routing = new FakeRoutingRepository();
    routing.options = [];
    const contactProfile = new FakeContactProfileService();
    contactProfile.collectionEnabled = true;
    const meta = { sendTextMessage: vi.fn().mockResolvedValue({}) };
    const contactResolutionService = { resolve: vi.fn().mockResolvedValue(resolvedContact) };
    const glpiClient = { createTicket: vi.fn(), addFollowUp: vi.fn() };

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
      { routing, meta, contactProfile },
    );

    const result = await service.process(basePayload);

    expect(result.results[0]?.outcome).toBe('processed');
    expect(glpiClient.createTicket).not.toHaveBeenCalled();
    expect(conversationRepository.lastCreateInput?.status).toBe('collecting_contact_profile');
    expect(meta.sendTextMessage).toHaveBeenCalledWith({
      to: '5511999999999',
      body: `${contactProfile.prompt}\n\nSe quiser encerrar este atendimento, digite cancelar a qualquer momento.`,
    });
  });

  it.each([
    [1, sampleRoutingOptions.slice(0, 1)],
    [2, sampleRoutingOptions],
    [3, fourRoutingOptions.slice(0, 3)],
  ])('with %i active routing option(s), first contact sends interactive buttons', async (_count, options) => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    const routing = new FakeRoutingRepository();
    routing.options = options;
    const meta = {
      sendTextMessage: vi.fn().mockResolvedValue({}),
      sendReplyButtons: vi.fn().mockResolvedValue({}),
    };
    const contactResolutionService = { resolve: vi.fn().mockResolvedValue(resolvedContact) };
    const glpiClient = { createTicket: vi.fn(), addFollowUp: vi.fn() };

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
      { routing, meta },
    );

    const result = await service.process(basePayload);

    expect(result.results[0]?.outcome).toBe('processed');
    expect(glpiClient.createTicket).not.toHaveBeenCalled();
    expect(meta.sendTextMessage).not.toHaveBeenCalled();
    expect(meta.sendReplyButtons).toHaveBeenCalledTimes(1);
    expect(meta.sendReplyButtons).toHaveBeenCalledWith(
      '5511999999999',
      'Escolha uma opÃ§Ã£o:',
      options.map((option) => ({ id: option.optionKey, title: option.label })),
    );
    expect(conversationRepository.lastCreateInput?.status).toBe('awaiting_queue_selection');
  });

  it('with four active routing options, first contact keeps textual menu fallback', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    const routing = new FakeRoutingRepository();
    routing.options = fourRoutingOptions;
    const meta = {
      sendTextMessage: vi.fn().mockResolvedValue({}),
      sendReplyButtons: vi.fn().mockResolvedValue({}),
    };
    const contactResolutionService = { resolve: vi.fn().mockResolvedValue(resolvedContact) };
    const glpiClient = { createTicket: vi.fn(), addFollowUp: vi.fn() };

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
      { routing, meta },
    );

    const result = await service.process(basePayload);

    expect(result.results[0]?.outcome).toBe('processed');
    expect(meta.sendReplyButtons).not.toHaveBeenCalled();
    expect(meta.sendTextMessage).toHaveBeenCalledTimes(1);
    expect(meta.sendTextMessage.mock.calls[0]?.[0].body).toContain('4 - Ouvidoria');
    expect(glpiClient.createTicket).not.toHaveBeenCalled();
  });

  it('falls back to textual menu if interactive button send fails', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    const routing = new FakeRoutingRepository();
    routing.options = sampleRoutingOptions;
    const meta = {
      sendTextMessage: vi.fn().mockResolvedValue({}),
      sendReplyButtons: vi.fn().mockRejectedValue(new Error('Meta unavailable')),
    };
    const contactResolutionService = { resolve: vi.fn().mockResolvedValue(resolvedContact) };
    const glpiClient = { createTicket: vi.fn(), addFollowUp: vi.fn() };

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
      { routing, meta },
    );

    const result = await service.process(basePayload);

    expect(result.results[0]?.outcome).toBe('processed');
    expect(meta.sendReplyButtons).toHaveBeenCalledTimes(1);
    expect(meta.sendTextMessage).toHaveBeenCalledTimes(1);
    expect(meta.sendTextMessage.mock.calls[0]?.[0].body).toContain('1 - Suporte');
    expect(glpiClient.createTicket).not.toHaveBeenCalled();
  });

  it('with active routing, valid digit creates ticket with assignment and stores queue on link', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    const contactResolutionService = { resolve: vi.fn().mockResolvedValue(resolvedContact) };
    conversationRepository.reusableConversation = {
      id: 'conv-awaiting',
      phoneE164: '+5511999999999',
      contactId: 'contact-1',
      glpiTicketId: null,
      queueId: null,
      status: 'awaiting_queue_selection',
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    messageRepository.reservedMessage = {
      ...(messageRepository.reservedMessage as NonNullable<typeof messageRepository.reservedMessage>),
      messageText: '1',
    };
    const routing = new FakeRoutingRepository();
    routing.options = sampleRoutingOptions;
    const entityMemory = makeEntityMemoryRepository();
    const meta = { sendTextMessage: vi.fn().mockResolvedValue({}) };
    const glpiClient = { createTicket: vi.fn().mockResolvedValue(888), addFollowUp: vi.fn() };

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
      { routing, meta, entityMemory },
    );

    const digitOnePayload = structuredClone(basePayload) as typeof basePayload;
    digitOnePayload.entry[0].changes[0].value.messages[0].text.body = '1';

    const result = await service.process(digitOnePayload);

    expect(result.results[0]?.outcome).toBe('processed');
    expect(glpiClient.createTicket).toHaveBeenCalledTimes(1);
    expect(glpiClient.createTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        assignedGroupId: 10,
        assignedUserId: null,
      }),
      { timeoutMs: 5000 },
    );
    expect(conversationRepository.linkedTickets[0]).toEqual(expect.objectContaining({
      conversationId: 'conv-awaiting',
      ticketId: 888,
      queueId: 5,
    }));
    expect(meta.sendTextMessage).toHaveBeenCalledTimes(1);
    expect(meta.sendTextMessage.mock.calls[0]?.[0].body).toContain(
      'Obrigado! Chamado #888 encaminhado ao Suporte.',
    );
  });

  it('with active routing, interactive button id maps to option_key and creates the ticket', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    const contactResolutionService = { resolve: vi.fn().mockResolvedValue(resolvedContact) };
    conversationRepository.reusableConversation = {
      id: 'conv-awaiting',
      phoneE164: '+5511999999999',
      contactId: 'contact-1',
      glpiTicketId: null,
      queueId: null,
      status: 'awaiting_queue_selection',
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const routing = new FakeRoutingRepository();
    routing.options = sampleRoutingOptions;
    const entityMemory = makeEntityMemoryRepository();
    const meta = { sendTextMessage: vi.fn().mockResolvedValue({}) };
    const glpiClient = { createTicket: vi.fn().mockResolvedValue(889), addFollowUp: vi.fn() };

    const interactivePayload = structuredClone(basePayload) as typeof basePayload;
    interactivePayload.entry[0].changes[0].value.messages[0] = {
      id: 'wamid.button-suporte',
      from: '5511999999999',
      type: 'interactive',
      interactive: {
        type: 'button_reply',
        button_reply: {
          id: 'suporte',
          title: 'Suporte',
        },
      },
    } as never;

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
      { routing, meta, entityMemory },
    );

    const result = await service.process(interactivePayload);

    expect(result.results[0]?.outcome).toBe('processed');
    expect(glpiClient.createTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        assignedGroupId: 10,
        assignedUserId: null,
      }),
      { timeoutMs: 5000 },
    );
    expect(conversationRepository.linkedTickets[0]).toEqual(expect.objectContaining({
      conversationId: 'conv-awaiting',
      ticketId: 889,
      queueId: 5,
    }));
    expect(meta.sendTextMessage.mock.calls[0]?.[0].body).toContain(
      'Obrigado! Chamado #889 encaminhado ao Suporte.',
    );
  });

  it('with active routing, uses the global ticket_created_message when option has no confirmationMessage', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    const contactResolutionService = { resolve: vi.fn().mockResolvedValue(resolvedContact) };
    conversationRepository.reusableConversation = {
      id: 'conv-awaiting',
      phoneE164: '+5511999999999',
      contactId: 'contact-1',
      glpiTicketId: null,
      queueId: null,
      status: 'awaiting_queue_selection',
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    messageRepository.reservedMessage = {
      ...(messageRepository.reservedMessage as NonNullable<typeof messageRepository.reservedMessage>),
      messageText: '2',
    };
    const routing = new FakeRoutingRepository();
    routing.options = sampleRoutingOptions;
    const entityMemory = makeEntityMemoryRepository();
    const meta = { sendTextMessage: vi.fn().mockResolvedValue({}) };
    const glpiClient = { createTicket: vi.fn().mockResolvedValue(888), addFollowUp: vi.fn() };

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
      { routing, meta, entityMemory },
    );

    const digitTwoPayload = structuredClone(basePayload) as typeof basePayload;
    digitTwoPayload.entry[0].changes[0].value.messages[0].text.body = '2';

    const result = await service.process(digitTwoPayload);

    expect(result.results[0]?.outcome).toBe('processed');
    expect(glpiClient.createTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        assignedGroupId: null,
        assignedUserId: 20,
      }),
      { timeoutMs: 5000 },
    );
    expect(conversationRepository.linkedTickets[0]).toEqual(expect.objectContaining({
      conversationId: 'conv-awaiting',
      ticketId: 888,
      queueId: 6,
    }));
    expect(meta.sendTextMessage).toHaveBeenCalledTimes(1);
    expect(meta.sendTextMessage.mock.calls[0]?.[0].body).toContain('Seu chamado #888 foi aberto.');
  });

  it('with active routing, invalid digit resends menu without creating a ticket', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    const contactResolutionService = { resolve: vi.fn().mockResolvedValue(resolvedContact) };
    conversationRepository.reusableConversation = {
      id: 'conv-awaiting',
      phoneE164: '+5511999999999',
      contactId: 'contact-1',
      glpiTicketId: null,
      queueId: null,
      status: 'awaiting_queue_selection',
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    messageRepository.reservedMessage = {
      ...(messageRepository.reservedMessage as NonNullable<typeof messageRepository.reservedMessage>),
      messageText: '99',
    };
    const routing = new FakeRoutingRepository();
    routing.options = sampleRoutingOptions;
    const meta = { sendTextMessage: vi.fn().mockResolvedValue({}) };
    const glpiClient = { createTicket: vi.fn(), addFollowUp: vi.fn() };
    const audit = {
      recordAuditEventFireAndForget: vi.fn(),
    } as unknown as AuditService;

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
      { routing, meta, audit },
    );

    const result = await service.process(basePayload);

    expect(result.results[0]?.outcome).toBe('processed');
    expect(glpiClient.createTicket).not.toHaveBeenCalled();
    expect(meta.sendTextMessage).toHaveBeenCalledTimes(1);
    expect(meta.sendTextMessage.mock.calls[0]?.[0].body).toMatch(/Nao entendi/);
    expect(meta.sendTextMessage.mock.calls[0]?.[0].body).toContain('1 - Suporte');
    expect(meta.sendTextMessage.mock.calls[0]?.[0].body).toContain('\n\n');
    expect(conversationRepository.updatedStatuses).toEqual([]);
    expect(audit.recordAuditEventFireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'ROUTING_MENU_SENT',
        conversationId: 'conv-awaiting',
        payload: expect.objectContaining({
          context: 'invalid_option',
          options_count: 2,
          delivery_mode: 'text',
        }),
      }),
    );
  });

  it('with active routing, invalid interactive button id resends interactive menu without creating a ticket', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    const contactResolutionService = { resolve: vi.fn().mockResolvedValue(resolvedContact) };
    conversationRepository.reusableConversation = {
      id: 'conv-awaiting',
      phoneE164: '+5511999999999',
      contactId: 'contact-1',
      glpiTicketId: null,
      queueId: null,
      status: 'awaiting_queue_selection',
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const routing = new FakeRoutingRepository();
    routing.options = sampleRoutingOptions;
    const meta = {
      sendTextMessage: vi.fn().mockResolvedValue({}),
      sendReplyButtons: vi.fn().mockResolvedValue({}),
    };
    const glpiClient = { createTicket: vi.fn(), addFollowUp: vi.fn() };

    const interactivePayload = structuredClone(basePayload) as typeof basePayload;
    interactivePayload.entry[0].changes[0].value.messages[0] = {
      id: 'wamid.button-invalid',
      from: '5511999999999',
      type: 'interactive',
      interactive: {
        type: 'button_reply',
        button_reply: {
          id: 'inexistente',
          title: 'Inexistente',
        },
      },
    } as never;

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
      { routing, meta },
    );

    const result = await service.process(interactivePayload);

    expect(result.results[0]?.outcome).toBe('processed');
    expect(glpiClient.createTicket).not.toHaveBeenCalled();
    expect(meta.sendReplyButtons).toHaveBeenCalledTimes(1);
    expect(meta.sendReplyButtons.mock.calls[0]?.[1]).toContain('Nao entendi');
    expect(meta.sendTextMessage).not.toHaveBeenCalled();
    expect(conversationRepository.updatedStatuses).toEqual([]);
  });

  it('with active routing, duplicate interactive button webhook does not create duplicate ticket', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    const contactResolutionService = { resolve: vi.fn().mockResolvedValue(resolvedContact) };
    conversationRepository.reusableConversation = {
      id: 'conv-awaiting',
      phoneE164: '+5511999999999',
      contactId: 'contact-1',
      glpiTicketId: null,
      queueId: null,
      status: 'awaiting_queue_selection',
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    let reserved = false;
    messageRepository.reserveInbound = vi.fn(async (input) => {
      if (reserved) {
        return null;
      }
      reserved = true;
      return {
        ...(messageRepository.reservedMessage as NonNullable<typeof messageRepository.reservedMessage>),
        messageId: input.messageId,
        senderPhone: input.senderPhone,
        recipientPhone: input.recipientPhone,
        messageText: input.messageText,
        rawPayload: input.rawPayload,
      };
    });
    const routing = new FakeRoutingRepository();
    routing.options = sampleRoutingOptions;
    const entityMemory = makeEntityMemoryRepository();
    const meta = { sendTextMessage: vi.fn().mockResolvedValue({}) };
    const glpiClient = { createTicket: vi.fn().mockResolvedValue(890), addFollowUp: vi.fn() };

    const interactivePayload = structuredClone(basePayload) as typeof basePayload;
    interactivePayload.entry[0].changes[0].value.messages[0] = {
      id: 'wamid.button-duplicate',
      from: '5511999999999',
      type: 'interactive',
      interactive: {
        type: 'button_reply',
        button_reply: {
          id: 'suporte',
          title: 'Suporte',
        },
      },
    } as never;

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
      { routing, meta, entityMemory },
    );

    const [first, second] = await Promise.all([
      service.process(interactivePayload),
      service.process(interactivePayload),
    ]);

    const outcomes = [first.results[0]?.outcome, second.results[0]?.outcome].sort();
    expect(outcomes).toEqual(['duplicate', 'processed']);
    expect(glpiClient.createTicket).toHaveBeenCalledTimes(1);
  });

  it('approves a solved ticket from solution button after validating conversation, ticket and phone', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    const contactResolutionService = { resolve: vi.fn().mockResolvedValue(resolvedContact) };
    conversationRepository.latestClosedConversation = {
      id: 'conv-solved',
      phoneE164: '+5511999999999',
      contactId: 'contact-1',
      glpiTicketId: 1234,
      queueId: 5,
      status: 'closed',
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const meta = { sendTextMessage: vi.fn().mockResolvedValue({}) };
    const glpiClient = {
      createTicket: vi.fn(),
      addFollowUp: vi.fn().mockResolvedValue(11),
      getTicket: vi.fn().mockResolvedValue({ id: 1234, status: 5 }),
      closeTicket: vi.fn().mockResolvedValue(undefined),
      approveTicketSolution: vi.fn().mockResolvedValue(undefined),
      reopenTicket: vi.fn(),
    };
    const solutionActions = new FakeSolutionActionRepository();
    const audit = {
      recordAuditEventFireAndForget: vi.fn(),
    } as unknown as AuditService;

    const payload = structuredClone(basePayload) as typeof basePayload;
    payload.entry[0].changes[0].value.messages[0] = {
      id: 'wamid.solution-approve',
      from: '5511999999999',
      type: 'interactive',
      interactive: {
        type: 'button_reply',
        button_reply: {
          id: 'solution_approve:1234:conv-solved',
          title: 'Aprovar',
        },
      },
    } as never;

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
      { meta, solutionActions, audit },
    );

    const result = await service.process(payload, { correlationId: 'WA-20260510153022-a8f3c2' });

    expect(result.results[0]?.outcome).toBe('processed');
    expect(glpiClient.approveTicketSolution).toHaveBeenCalledWith(
      1234,
      [
        'Cliente aprovou a solução via WhatsApp.',
        '',
        'Telefone: +5511999999999',
        'Conversation ID: conv-solved',
        'Ação: approve',
        'Origem: WhatsApp',
      ].join('\n'),
    );
    expect(glpiClient.addFollowUp).not.toHaveBeenCalled();
    expect(glpiClient.closeTicket).not.toHaveBeenCalled();
    expect(conversationRepository.updatedStatuses).toContainEqual({
      conversationId: 'conv-solved',
      status: 'closed',
    });
    expect(solutionActions.reserveCalls).toHaveLength(1);
    expect(solutionActions.reserveCalls[0]).toMatchObject({
      actionKey: 'solution:approve:1234:conv-solved',
      whatsappMessageId: 'wamid.solution-approve',
      ticketId: 1234,
      conversationId: 'conv-solved',
      phoneE164: '+5511999999999',
      action: 'approve',
      previousTicketStatus: 5,
    });
    expect(solutionActions.markSuccessCalls).toEqual([
      { id: 'solution-action-1', finalTicketStatus: 6 },
    ]);
    expect(audit.recordAuditEventFireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({
        correlationId: 'WA-20260510153022-a8f3c2',
        ticketId: 1234,
        conversationId: 'conv-solved',
        messageId: 'wamid.solution-approve',
        direction: 'inbound',
        eventType: 'TICKET_CLOSED',
        status: 'success',
        severity: 'info',
        source: 'InboundWebhookService',
        payload: { action: 'solution_approve' },
      }),
    );
    expect(meta.sendTextMessage).not.toHaveBeenCalled();
    expect(glpiClient.createTicket).not.toHaveBeenCalled();
  });

  it('asks for a configured reopen reason before reopening from solution button', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    const contactResolutionService = { resolve: vi.fn().mockResolvedValue(resolvedContact) };
    conversationRepository.latestClosedConversation = {
      id: 'conv-solved',
      phoneE164: '+5511999999999',
      contactId: 'contact-1',
      glpiTicketId: 1234,
      queueId: 5,
      status: 'closed',
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const meta = {
      sendTextMessage: vi.fn().mockResolvedValue({}),
      sendReplyButtons: vi.fn().mockResolvedValue({}),
      sendListMessage: vi.fn().mockResolvedValue({}),
    };
    const glpiClient = {
      createTicket: vi.fn(),
      addFollowUp: vi.fn().mockResolvedValue(12),
      getTicket: vi.fn().mockResolvedValue({ id: 1234, status: 5 }),
      closeTicket: vi.fn(),
      reopenTicket: vi.fn().mockResolvedValue(undefined),
      reopenTicketSolution: vi.fn().mockResolvedValue(undefined),
    };
    const solutionActions = new FakeSolutionActionRepository();
    const audit = {
      recordAuditEventFireAndForget: vi.fn(),
    } as unknown as AuditService;

    const payload = structuredClone(basePayload) as typeof basePayload;
    payload.entry[0].changes[0].value.messages[0] = {
      id: 'wamid.solution-reopen',
      from: '5511999999999',
      type: 'interactive',
      interactive: {
        type: 'button_reply',
        button_reply: {
          id: 'solution_reopen:1234:conv-solved',
          title: 'Reabrir',
        },
      },
    } as never;

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
      { meta, solutionActions, audit },
    );

    const result = await service.process(payload, { correlationId: 'WA-20260510153022-a8f3c2' });

    expect(result.results[0]?.outcome).toBe('processed');
    expect(glpiClient.reopenTicketSolution).not.toHaveBeenCalled();
    expect(glpiClient.addFollowUp).not.toHaveBeenCalled();
    expect(glpiClient.reopenTicket).not.toHaveBeenCalled();
    expect(meta.sendReplyButtons).not.toHaveBeenCalled();
    expect(meta.sendListMessage).toHaveBeenCalledWith(
      '5511999999999',
      'Qual o motivo da reabertura?',
      [
        { id: 'solution_reopen_reason:problem_persists:1234:conv-solved', title: 'O problema permanece' },
        { id: 'solution_reopen_reason:missing_work:1234:conv-solved', title: 'Ficou faltando algo' },
        { id: 'solution_reopen_reason:not_understood:1234:conv-solved', title: 'Não entendi a solução' },
        { id: 'solution_reopen_reason:other:1234:conv-solved', title: 'Outro motivo' },
      ],
      'Motivos',
      'Reabertura',
    );
    expect(meta.sendTextMessage).not.toHaveBeenCalled();
    expect(solutionActions.reserveCalls).toEqual([]);
    expect(solutionActions.markSuccessCalls).toEqual([]);
    expect(audit.recordAuditEventFireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({
        correlationId: 'WA-20260510153022-a8f3c2',
        ticketId: 1234,
        conversationId: 'conv-solved',
        messageId: 'wamid.solution-reopen',
        direction: 'inbound',
        eventType: 'TICKET_UPDATED',
        status: 'success',
        severity: 'info',
        source: 'InboundWebhookService',
        payload: { action: 'solution_reopen_reason_prompt' },
      }),
    );
    expect(glpiClient.createTicket).not.toHaveBeenCalled();
  });

  it('reopens a solved ticket only after the customer selects a reopen reason', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    const contactResolutionService = { resolve: vi.fn().mockResolvedValue(resolvedContact) };
    conversationRepository.latestClosedConversation = {
      id: 'conv-solved',
      phoneE164: '+5511999999999',
      contactId: 'contact-1',
      glpiTicketId: 1234,
      queueId: 5,
      status: 'closed',
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const meta = {
      sendTextMessage: vi.fn().mockResolvedValue({}),
      sendReplyButtons: vi.fn().mockResolvedValue({}),
      sendListMessage: vi.fn().mockResolvedValue({}),
    };
    const glpiClient = {
      createTicket: vi.fn(),
      addFollowUp: vi.fn().mockResolvedValue(12),
      getTicket: vi.fn().mockResolvedValue({ id: 1234, status: 5 }),
      closeTicket: vi.fn(),
      reopenTicket: vi.fn().mockResolvedValue(undefined),
      reopenTicketSolution: vi.fn().mockResolvedValue(undefined),
    };
    const solutionActions = new FakeSolutionActionRepository();
    const audit = {
      recordAuditEventFireAndForget: vi.fn(),
    } as unknown as AuditService;
    const messageConfiguration = {
      getMessage: vi.fn(async (eventKey: string) => ({
        eventKey,
        group: 'Ticket e Solução',
        description: eventKey,
        defaultText: eventKey === 'solution_reopened_confirmation'
          ? 'Chamado {{ticket_id}} reaberto com motivo.'
          : 'Problema ainda ocorre',
        customText: null,
        fallbackText: null,
        sendType: 'text',
        language: 'pt_BR',
        isActive: true,
        expectsResponse: false,
        templateName: null,
        buttons: [],
        listOptions: [],
        updatedAt: new Date(),
        updatedBy: null,
      })),
    };

    const payload = structuredClone(basePayload) as typeof basePayload;
    payload.entry[0].changes[0].value.messages[0] = {
      id: 'wamid.solution-reopen-reason',
      from: '5511999999999',
      type: 'interactive',
      interactive: {
        type: 'list_reply',
        list_reply: {
          id: 'solution_reopen_reason:problem_persists:1234:conv-solved',
          title: 'O problema permanece',
        },
      },
    } as never;

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
      { meta, solutionActions, audit, messageConfiguration },
    );

    const result = await service.process(payload, { correlationId: 'WA-20260510153022-a8f3c2' });

    expect(result.results[0]?.outcome).toBe('processed');
    expect(glpiClient.reopenTicketSolution).toHaveBeenCalledWith(
      1234,
      [
        'Cliente solicitou reabertura via WhatsApp. Motivo: Problema ainda ocorre.',
        '',
        'Telefone: +5511999999999',
        'Conversation ID: conv-solved',
        'Ação: reopen',
        'Motivo da reabertura: Problema ainda ocorre',
        'Origem: WhatsApp',
      ].join('\n'),
    );
    expect(conversationRepository.reopenedConversationIds).toEqual(['conv-solved']);
    expect(meta.sendTextMessage).toHaveBeenCalledWith({
      to: '5511999999999',
      body: 'Chamado 1234 reaberto com motivo.',
    });
    expect(solutionActions.reserveCalls[0]).toMatchObject({
      actionKey: 'solution:reopen:1234:conv-solved:problem_persists',
      action: 'reopen',
    });
    expect(solutionActions.markSuccessCalls).toEqual([
      { id: 'solution-action-1', finalTicketStatus: 2 },
    ]);
    expect(audit.recordAuditEventFireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'TICKET_UPDATED',
        payload: { action: 'solution_reopen', reopen_reason: 'problem_persists' },
      }),
    );
  });

  it('approves a solved ticket from positive CSAT button and records the rating', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    const contactResolutionService = { resolve: vi.fn().mockResolvedValue(resolvedContact) };
    conversationRepository.latestClosedConversation = {
      id: 'conv-solved',
      phoneE164: '+5511999999999',
      contactId: 'contact-1',
      glpiTicketId: 1234,
      queueId: 5,
      status: 'closed',
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const meta = { sendTextMessage: vi.fn().mockResolvedValue({}) };
    const glpiClient = {
      createTicket: vi.fn(),
      addFollowUp: vi.fn(),
      getTicket: vi.fn().mockResolvedValue({ id: 1234, status: 5 }),
      approveTicketSolution: vi.fn().mockResolvedValue(undefined),
      reopenTicketSolution: vi.fn(),
    };
    const solutionActions = new FakeSolutionActionRepository();
    const audit = {
      recordAuditEventFireAndForget: vi.fn(),
    } as unknown as AuditService;

    const payload = structuredClone(basePayload) as typeof basePayload;
    payload.entry[0].changes[0].value.messages[0] = {
      id: 'wamid.solution-csat-positive',
      from: '5511999999999',
      type: 'interactive',
      interactive: {
        type: 'button_reply',
        button_reply: {
          id: 'solution_csat:very_satisfied:1234:conv-solved',
          title: 'Muito satisfeito',
        },
      },
    } as never;

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
      { meta, solutionActions, audit },
    );

    const result = await service.process(payload, { correlationId: 'WA-20260510153022-csat1' });

    expect(result.results[0]?.outcome).toBe('processed');
    expect(glpiClient.approveTicketSolution).toHaveBeenCalledWith(
      1234,
      [
        'Cliente aprovou a solução via WhatsApp.',
        '',
        'Telefone: +5511999999999',
        'Conversation ID: conv-solved',
        'Ação: approve',
        'CSAT: very_satisfied',
        'Revisão de supervisor: não',
        'Origem: WhatsApp',
      ].join('\n'),
    );
    expect(solutionActions.reserveCalls[0]).toMatchObject({
      action: 'approve',
      csatRating: 'very_satisfied',
      supervisorReviewRequired: false,
    });
    expect(solutionActions.markSuccessCalls).toEqual([
      { id: 'solution-action-1', finalTicketStatus: 6 },
    ]);
    expect(audit.recordAuditEventFireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'TICKET_CLOSED',
        payload: { action: 'solution_approve', csat_rating: 'very_satisfied' },
      }),
    );
    expect(meta.sendTextMessage).toHaveBeenCalledWith({
      to: '5511999999999',
      body: 'Seu chamado foi encerrado. Obrigado pela avaliação.',
    });
    expect(audit.recordAuditEventFireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'CSAT_THANK_YOU_CLOSURE_SENT',
        conversationId: 'conv-solved',
      }),
    );
  });

  it('records dissatisfied CSAT on an already closed ticket without reopening or expiring the action', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    const contactResolutionService = { resolve: vi.fn().mockResolvedValue(resolvedContact) };
    conversationRepository.latestClosedConversation = {
      id: 'conv-solved',
      phoneE164: '+5511999999999',
      contactId: 'contact-1',
      glpiTicketId: 1234,
      queueId: 5,
      status: 'closed',
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const meta = { sendTextMessage: vi.fn().mockResolvedValue({}) };
    const glpiClient = {
      createTicket: vi.fn(),
      addFollowUp: vi.fn().mockResolvedValue(991),
      getTicket: vi.fn().mockResolvedValue({ id: 1234, status: 6 }),
      approveTicketSolution: vi.fn(),
      reopenTicketSolution: vi.fn(),
    };
    const solutionActions = new FakeSolutionActionRepository();
    const audit = {
      recordAuditEventFireAndForget: vi.fn(),
    } as unknown as AuditService;

    const payload = structuredClone(basePayload) as typeof basePayload;
    payload.entry[0].changes[0].value.messages[0] = {
      id: 'wamid.solution-csat-dissatisfied',
      from: '5511999999999',
      type: 'interactive',
      interactive: {
        type: 'button_reply',
        button_reply: {
          id: 'solution_csat:dissatisfied:1234:conv-solved',
          title: 'Insatisfeito',
        },
      },
    } as never;

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
      { meta, solutionActions, audit },
    );

    const result = await service.process(payload, { correlationId: 'WA-20260510153022-csat2' });

    expect(result.results[0]?.outcome).toBe('processed');
    expect(glpiClient.addFollowUp).toHaveBeenCalledWith({
      ticketId: 1234,
      content: [
        'Cliente indicou insatisfação na pesquisa via WhatsApp. O chamado deve seguir em atendimento e revisão.',
        '',
        'Telefone: +5511999999999',
        'Conversation ID: conv-solved',
        'Ação: approve',
        'CSAT: dissatisfied',
        'Revisão de supervisor: sim',
        'Origem: WhatsApp',
      ].join('\n'),
    });
    expect(glpiClient.approveTicketSolution).not.toHaveBeenCalled();
    expect(glpiClient.reopenTicketSolution).not.toHaveBeenCalled();
    expect(conversationRepository.updatedStatuses).toContainEqual({ conversationId: 'conv-solved', status: 'closed' });
    expect(conversationRepository.reopenedConversationIds).toEqual([]);
    expect(solutionActions.reserveCalls[0]).toMatchObject({
      actionKey: 'solution:approve:1234:conv-solved:csat:dissatisfied',
      action: 'approve',
      csatRating: 'dissatisfied',
      supervisorReviewRequired: true,
    });
    expect(solutionActions.markSuccessCalls).toEqual([
      { id: 'solution-action-1', finalTicketStatus: 6 },
    ]);
    expect(meta.sendTextMessage).toHaveBeenCalledWith({
      to: '5511999999999',
      body: 'Seu chamado foi encerrado. Obrigado pela avaliação.',
    });
    expect(audit.recordAuditEventFireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'TICKET_CLOSED',
        payload: {
          action: 'solution_approve',
          csat_rating: 'dissatisfied',
          supervisor_review_required: true,
        },
      }),
    );
    expect(audit.recordAuditEventFireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'CSAT_THANK_YOU_CLOSURE_SENT',
        conversationId: 'conv-solved',
      }),
    );
  });

  it('accepts dissatisfied CSAT on a solved ticket using the same approval path as good ratings', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    const contactResolutionService = { resolve: vi.fn().mockResolvedValue(resolvedContact) };
    conversationRepository.latestClosedConversation = {
      id: 'conv-solved',
      phoneE164: '+5511999999999',
      contactId: 'contact-1',
      glpiTicketId: 1234,
      queueId: 5,
      status: 'closed',
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const meta = { sendTextMessage: vi.fn().mockResolvedValue({}) };
    const glpiClient = {
      createTicket: vi.fn(),
      addFollowUp: vi.fn(),
      getTicket: vi.fn().mockResolvedValue({ id: 1234, status: 5 }),
      approveTicketSolution: vi.fn().mockResolvedValue(undefined),
      reopenTicketSolution: vi.fn(),
    };
    const solutionActions = new FakeSolutionActionRepository();
    const audit = {
      recordAuditEventFireAndForget: vi.fn(),
    } as unknown as AuditService;

    const payload = structuredClone(basePayload) as typeof basePayload;
    payload.entry[0].changes[0].value.messages[0] = {
      id: 'wamid.solution-csat-dissatisfied-solved',
      from: '5511999999999',
      type: 'interactive',
      interactive: {
        type: 'button_reply',
        button_reply: {
          id: 'solution_csat:dissatisfied:1234:conv-solved',
          title: 'Insatisfeito',
        },
      },
    } as never;

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
      { meta, solutionActions, audit },
    );

    const result = await service.process(payload, { correlationId: 'WA-20260510153022-csat3' });

    expect(result.results[0]?.outcome).toBe('processed');
    expect(glpiClient.approveTicketSolution).toHaveBeenCalledWith(
      1234,
      [
        'Cliente indicou insatisfação na pesquisa via WhatsApp. O chamado deve seguir em atendimento e revisão.',
        '',
        'Telefone: +5511999999999',
        'Conversation ID: conv-solved',
        'Ação: approve',
        'CSAT: dissatisfied',
        'Revisão de supervisor: sim',
        'Origem: WhatsApp',
      ].join('\n'),
    );
    expect(glpiClient.reopenTicketSolution).not.toHaveBeenCalled();
    expect(conversationRepository.updatedStatuses).toContainEqual({ conversationId: 'conv-solved', status: 'closed' });
    expect(solutionActions.reserveCalls[0]).toMatchObject({
      actionKey: 'solution:approve:1234:conv-solved:csat:dissatisfied',
      action: 'approve',
      csatRating: 'dissatisfied',
      supervisorReviewRequired: true,
    });
    expect(solutionActions.markSuccessCalls).toEqual([
      { id: 'solution-action-1', finalTicketStatus: 6 },
    ]);
    expect(meta.sendTextMessage).toHaveBeenCalledWith({
      to: '5511999999999',
      body: 'Seu chamado foi encerrado. Obrigado pela avaliação.',
    });
    expect(audit.recordAuditEventFireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'TICKET_CLOSED',
        payload: {
          action: 'solution_approve',
          csat_rating: 'dissatisfied',
          supervisor_review_required: true,
        },
      }),
    );
    expect(audit.recordAuditEventFireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'CSAT_THANK_YOU_CLOSURE_SENT',
      }),
    );
  });

  it('rejects stale solution button when ticket is already closed', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    const contactResolutionService = { resolve: vi.fn().mockResolvedValue(resolvedContact) };
    conversationRepository.latestClosedConversation = {
      id: 'conv-solved',
      phoneE164: '+5511999999999',
      contactId: 'contact-1',
      glpiTicketId: 1234,
      queueId: 5,
      status: 'closed',
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const meta = { sendTextMessage: vi.fn().mockResolvedValue({}) };
    const glpiClient = {
      createTicket: vi.fn(),
      addFollowUp: vi.fn(),
      getTicket: vi.fn().mockResolvedValue({ id: 1234, status: 6 }),
      closeTicket: vi.fn(),
      reopenTicket: vi.fn(),
      reopenTicketSolution: vi.fn(),
    };
    const solutionActions = new FakeSolutionActionRepository();

    const payload = structuredClone(basePayload) as typeof basePayload;
    payload.entry[0].changes[0].value.messages[0] = {
      id: 'wamid.solution-stale',
      from: '5511999999999',
      type: 'interactive',
      interactive: {
        type: 'button_reply',
        button_reply: {
          id: 'solution_reopen:1234:conv-solved',
          title: 'Reabrir',
        },
      },
    } as never;

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
      { meta, solutionActions },
    );

    const result = await service.process(payload);

    expect(result.results[0]?.outcome).toBe('processed');
    expect(glpiClient.addFollowUp).not.toHaveBeenCalled();
    expect(glpiClient.closeTicket).not.toHaveBeenCalled();
    expect(glpiClient.reopenTicket).not.toHaveBeenCalled();
    expect(glpiClient.reopenTicketSolution).not.toHaveBeenCalled();
    expect(glpiClient.createTicket).not.toHaveBeenCalled();
    expect(meta.sendTextMessage).toHaveBeenCalledWith({
      to: '5511999999999',
      body: 'Esta ação não está mais disponível para este chamado.',
    });
    expect(solutionActions.markIgnoredCalls).toHaveLength(0);
  });

  it('audits and ignores a duplicate successful solution action without updating GLPI again', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    const contactResolutionService = { resolve: vi.fn().mockResolvedValue(resolvedContact) };
    conversationRepository.latestClosedConversation = {
      id: 'conv-solved',
      phoneE164: '+5511999999999',
      contactId: 'contact-1',
      glpiTicketId: 1234,
      queueId: 5,
      status: 'closed',
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const meta = { sendTextMessage: vi.fn().mockResolvedValue({}) };
    const glpiClient = {
      createTicket: vi.fn(),
      addFollowUp: vi.fn(),
      getTicket: vi.fn().mockResolvedValue({ id: 1234, status: 5 }),
      closeTicket: vi.fn(),
      reopenTicket: vi.fn(),
      reopenTicketSolution: vi.fn(),
    };
    const solutionActions = new FakeSolutionActionRepository();
    solutionActions.successfulAction = {
      id: 'previous-success',
      actionKey: 'solution:approve:1234:conv-solved',
      whatsappMessageId: 'wamid.previous',
      ticketId: 1234,
      conversationId: 'conv-solved',
      phoneE164: '+5511999999999',
      action: 'approve',
      status: 'success',
      previousTicketStatus: 5,
      finalTicketStatus: 6,
      errorCode: null,
      errorMessage: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const payload = structuredClone(basePayload) as typeof basePayload;
    payload.entry[0].changes[0].value.messages[0] = {
      id: 'wamid.solution-approve-again',
      from: '5511999999999',
      type: 'interactive',
      interactive: {
        type: 'button_reply',
        button_reply: {
          id: 'solution_approve:1234:conv-solved',
          title: 'Aprovar',
        },
      },
    } as never;

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
      { meta, solutionActions },
    );

    const result = await service.process(payload);

    expect(result.results[0]?.outcome).toBe('processed');
    expect(solutionActions.reserveCalls).toHaveLength(1);
    expect(solutionActions.markIgnoredCalls).toEqual([
      {
        id: 'solution-action-1',
        errorCode: 'SOLUTION_ACTION_DUPLICATE',
        errorMessage: 'A successful solution action already exists for this ticket and conversation.',
      },
    ]);
    expect(glpiClient.closeTicket).not.toHaveBeenCalled();
    expect(glpiClient.addFollowUp).not.toHaveBeenCalled();
    expect(meta.sendTextMessage).not.toHaveBeenCalled();
  });

  it('does not send duplicate post-CSAT thank-you when the rating action was already processed', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    const contactResolutionService = { resolve: vi.fn().mockResolvedValue(resolvedContact) };
    conversationRepository.latestClosedConversation = {
      id: 'conv-solved',
      phoneE164: '+5511999999999',
      contactId: 'contact-1',
      glpiTicketId: 1234,
      queueId: 5,
      status: 'closed',
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const meta = { sendTextMessage: vi.fn().mockResolvedValue({}) };
    const glpiClient = {
      createTicket: vi.fn(),
      addFollowUp: vi.fn(),
      getTicket: vi.fn().mockResolvedValue({ id: 1234, status: 6 }),
      closeTicket: vi.fn(),
      reopenTicket: vi.fn(),
      reopenTicketSolution: vi.fn(),
      approveTicketSolution: vi.fn(),
    };
    const solutionActions = new FakeSolutionActionRepository();
    solutionActions.successfulAction = {
      id: 'previous-csat-success',
      actionKey: 'solution:approve:1234:conv-solved:csat:very_satisfied',
      whatsappMessageId: 'wamid.previous-csat',
      ticketId: 1234,
      conversationId: 'conv-solved',
      phoneE164: '+5511999999999',
      action: 'approve',
      status: 'success',
      previousTicketStatus: 6,
      finalTicketStatus: 6,
      errorCode: null,
      errorMessage: null,
      csatRating: 'very_satisfied',
      supervisorReviewRequired: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const payload = structuredClone(basePayload) as typeof basePayload;
    payload.entry[0].changes[0].value.messages[0] = {
      id: 'wamid.solution-csat-again',
      from: '5511999999999',
      type: 'interactive',
      interactive: {
        type: 'button_reply',
        button_reply: {
          id: 'solution_csat:very_satisfied:1234:conv-solved',
          title: 'Otimo',
        },
      },
    } as never;

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
      { meta, solutionActions },
    );

    const result = await service.process(payload);

    expect(result.results[0]?.outcome).toBe('processed');
    expect(solutionActions.reserveCalls).toHaveLength(1);
    expect(solutionActions.markIgnoredCalls).toEqual([
      {
        id: 'solution-action-1',
        errorCode: 'SOLUTION_ACTION_DUPLICATE',
        errorMessage: 'A successful solution action already exists for this ticket and conversation.',
      },
    ]);
    expect(glpiClient.approveTicketSolution).not.toHaveBeenCalled();
    expect(glpiClient.addFollowUp).not.toHaveBeenCalled();
    expect(meta.sendTextMessage).not.toHaveBeenCalled();
  });

  it('marks reopen action as error when GLPI add_reopen fails and keeps conversation closed', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    const contactResolutionService = { resolve: vi.fn().mockResolvedValue(resolvedContact) };
    conversationRepository.latestClosedConversation = {
      id: 'conv-solved',
      phoneE164: '+5511999999999',
      contactId: 'contact-1',
      glpiTicketId: 1234,
      queueId: 5,
      status: 'closed',
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const meta = { sendTextMessage: vi.fn().mockResolvedValue({}) };
    const glpiClient = {
      createTicket: vi.fn(),
      addFollowUp: vi.fn(),
      getTicket: vi.fn().mockResolvedValue({ id: 1234, status: 5 }),
      closeTicket: vi.fn(),
      reopenTicket: vi.fn(),
      reopenTicketSolution: vi.fn().mockRejectedValue(new Error('GLPI reopen rejected')),
    };
    const solutionActions = new FakeSolutionActionRepository();

    const payload = structuredClone(basePayload) as typeof basePayload;
    payload.entry[0].changes[0].value.messages[0] = {
      id: 'wamid.solution-reopen-fails',
      from: '5511999999999',
      type: 'interactive',
      interactive: {
        type: 'button_reply',
        button_reply: {
          id: 'solution_reopen_reason:problem_persists:1234:conv-solved',
          title: 'O problema permanece',
        },
      },
    } as never;

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
      { meta, solutionActions },
    );

    const result = await service.process(payload);

    expect(result.results[0]?.outcome).toBe('processed');
    expect(glpiClient.reopenTicketSolution).toHaveBeenCalledTimes(1);
    expect(glpiClient.reopenTicket).not.toHaveBeenCalled();
    expect(glpiClient.addFollowUp).not.toHaveBeenCalled();
    expect(solutionActions.markErrorCalls[0]).toMatchObject({
      id: 'solution-action-1',
      errorCode: 'GLPI_REOPEN_FAILED',
    });
    expect(conversationRepository.updatedStatuses).toEqual([]);
    expect(meta.sendTextMessage).toHaveBeenCalledWith({
      to: '5511999999999',
      body: 'Não conseguimos concluir sua ação agora. Tente novamente mais tarde.',
    });
  });

  it('marks solution action as error when GLPI status update fails', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    const contactResolutionService = { resolve: vi.fn().mockResolvedValue(resolvedContact) };
    conversationRepository.latestClosedConversation = {
      id: 'conv-solved',
      phoneE164: '+5511999999999',
      contactId: 'contact-1',
      glpiTicketId: 1234,
      queueId: 5,
      status: 'closed',
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const meta = { sendTextMessage: vi.fn().mockResolvedValue({}) };
    const glpiClient = {
      createTicket: vi.fn(),
      addFollowUp: vi.fn(),
      getTicket: vi.fn().mockResolvedValue({ id: 1234, status: 5 }),
      closeTicket: vi.fn().mockRejectedValue(new Error('GLPI down')),
      approveTicketSolution: vi.fn().mockRejectedValue(new Error('GLPI approval rejected')),
      reopenTicket: vi.fn(),
    };
    const solutionActions = new FakeSolutionActionRepository();

    const payload = structuredClone(basePayload) as typeof basePayload;
    payload.entry[0].changes[0].value.messages[0] = {
      id: 'wamid.solution-approve-update-fails',
      from: '5511999999999',
      type: 'interactive',
      interactive: {
        type: 'button_reply',
        button_reply: {
          id: 'solution_approve:1234:conv-solved',
          title: 'Aprovar',
        },
      },
    } as never;

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
      { meta, solutionActions },
    );

    const result = await service.process(payload);

    expect(result.results[0]?.outcome).toBe('processed');
    expect(solutionActions.markErrorCalls[0]).toMatchObject({
      id: 'solution-action-1',
      errorCode: 'GLPI_TICKET_UPDATE_FAILED',
    });
    expect(glpiClient.addFollowUp).not.toHaveBeenCalled();
    expect(conversationRepository.updatedStatuses).toEqual([]);
    expect(meta.sendTextMessage).not.toHaveBeenCalled();
  });

  it('keeps GLPI status update from being retried dangerously when solution follow-up fails', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    const contactResolutionService = { resolve: vi.fn().mockResolvedValue(resolvedContact) };
    conversationRepository.latestClosedConversation = {
      id: 'conv-solved',
      phoneE164: '+5511999999999',
      contactId: 'contact-1',
      glpiTicketId: 1234,
      queueId: 5,
      status: 'closed',
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const meta = { sendTextMessage: vi.fn().mockResolvedValue({}) };
    const glpiClient = {
      createTicket: vi.fn(),
      addFollowUp: vi.fn().mockRejectedValue(new Error('follow-up failed')),
      getTicket: vi.fn().mockResolvedValue({ id: 1234, status: 5 }),
      closeTicket: vi.fn().mockResolvedValue(undefined),
      approveTicketSolution: vi.fn().mockResolvedValue(undefined),
      reopenTicket: vi.fn(),
    };
    const solutionActions = new FakeSolutionActionRepository();

    const payload = structuredClone(basePayload) as typeof basePayload;
    payload.entry[0].changes[0].value.messages[0] = {
      id: 'wamid.solution-approve-followup-fails',
      from: '5511999999999',
      type: 'interactive',
      interactive: {
        type: 'button_reply',
        button_reply: {
          id: 'solution_approve:1234:conv-solved',
          title: 'Aprovar',
        },
      },
    } as never;

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
      { meta, solutionActions },
    );

    const result = await service.process(payload);

    expect(result.results[0]?.outcome).toBe('processed');
    expect(glpiClient.approveTicketSolution).toHaveBeenCalledTimes(1);
    expect(glpiClient.closeTicket).not.toHaveBeenCalled();
    expect(glpiClient.addFollowUp).not.toHaveBeenCalled();
    expect(solutionActions.markErrorCalls).toEqual([]);
    expect(conversationRepository.updatedStatuses).toContainEqual({
      conversationId: 'conv-solved',
      status: 'closed',
    });
    expect(meta.sendTextMessage).not.toHaveBeenCalled();
  });

  it('with active routing, null text while awaiting queue selection resends menu without creating a ticket', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    const contactResolutionService = { resolve: vi.fn().mockResolvedValue(resolvedContact) };
    conversationRepository.reusableConversation = {
      id: 'conv-awaiting',
      phoneE164: '+5511999999999',
      contactId: 'contact-1',
      glpiTicketId: null,
      queueId: null,
      status: 'awaiting_queue_selection',
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const routing = new FakeRoutingRepository();
    routing.options = sampleRoutingOptions;
    const meta = { sendTextMessage: vi.fn().mockResolvedValue({}) };
    const glpiClient = { createTicket: vi.fn(), addFollowUp: vi.fn() };

    const nullTextPayload = structuredClone(basePayload) as typeof basePayload;
    nullTextPayload.entry[0].changes[0].value.messages[0] = {
      id: 'wamid.null-text',
      from: '5511999999999',
      type: 'text',
      text: {},
    };

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
      { routing, meta },
    );

    const result = await service.process(nullTextPayload);

    expect(result.results[0]?.outcome).toBe('processed');
    expect(glpiClient.createTicket).not.toHaveBeenCalled();
    expect(meta.sendTextMessage).toHaveBeenCalledTimes(1);
    expect(meta.sendTextMessage.mock.calls[0]?.[0].body).toMatch(/apenas texto/);
    expect(meta.sendTextMessage.mock.calls[0]?.[0].body).toContain('1 - Suporte');
    expect(meta.sendTextMessage.mock.calls[0]?.[0].body).toContain('\n\n');
    expect(conversationRepository.updatedStatuses).toEqual([]);
    expect(messageRepository.updates[0]).toEqual({
      messageId: 'wamid.null-text',
      conversationId: 'conv-awaiting',
      processingStatus: 'processed',
      glpiSyncStatus: 'synced',
    });
  });

  it('with active routing, media while awaiting queue selection resends menu without crashing', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    const contactResolutionService = { resolve: vi.fn().mockResolvedValue(resolvedContact) };
    conversationRepository.reusableConversation = {
      id: 'conv-awaiting',
      phoneE164: '+5511999999999',
      contactId: 'contact-1',
      glpiTicketId: null,
      queueId: null,
      status: 'awaiting_queue_selection',
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const routing = new FakeRoutingRepository();
    routing.options = sampleRoutingOptions;
    const meta = { sendTextMessage: vi.fn().mockResolvedValue({}) };
    const glpiClient = { createTicket: vi.fn(), addFollowUp: vi.fn() };

    const mediaPayload = structuredClone(basePayload) as typeof basePayload;
    mediaPayload.entry[0].changes[0].value.messages[0] = {
      id: 'wamid.media',
      from: '5511999999999',
      type: 'image',
    };

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
      { routing, meta },
    );

    const result = await service.process(mediaPayload);

    expect(result.results[0]?.outcome).toBe('processed');
    expect(glpiClient.createTicket).not.toHaveBeenCalled();
    expect(meta.sendTextMessage).toHaveBeenCalledTimes(1);
    expect(meta.sendTextMessage.mock.calls[0]?.[0].body).toMatch(/apenas texto/);
    expect(meta.sendTextMessage.mock.calls[0]?.[0].body).toContain('1 - Suporte');
    expect(meta.sendTextMessage.mock.calls[0]?.[0].body).toContain('\n\n');
    expect(conversationRepository.updatedStatuses).toEqual([]);
    expect(messageRepository.updates[0]).toEqual({
      messageId: 'wamid.media',
      conversationId: 'conv-awaiting',
      processingStatus: 'processed',
      glpiSyncStatus: 'synced',
    });
  });

  it('8.0C guard: real image payload while awaiting queue selection never calls MediaProcessingService', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    const contactResolutionService = { resolve: vi.fn().mockResolvedValue(resolvedContact) };
    conversationRepository.reusableConversation = {
      id: 'conv-awaiting-real-image',
      phoneE164: '+5511999999999',
      contactId: 'contact-1',
      glpiTicketId: null,
      queueId: null,
      status: 'awaiting_queue_selection',
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const routing = new FakeRoutingRepository();
    routing.options = sampleRoutingOptions;
    const meta = { sendTextMessage: vi.fn().mockResolvedValue({}) };
    const glpiClient = { createTicket: vi.fn(), addFollowUp: vi.fn() };
    const fakeMediaProcessingService = {
      processMedia: vi.fn(),
    };

    const mediaPayload = structuredClone(basePayload) as typeof basePayload;
    mediaPayload.entry[0].changes[0].value.messages[0] = {
      id: 'wamid.media-real-image',
      from: '5511999999999',
      type: 'image',
      image: {
        id: 'media-id',
        mime_type: 'image/jpeg',
        caption: 'teste',
      },
    } as never;

    const service = new InboundWebhookService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService as never,
      glpiClient as never,
      new FakeKeyLock(),
      routing,
      new FakeSettingsService(),
      new FakeScheduleService(),
      meta as never,
      fakeMediaProcessingService,
    );

    const result = await service.process(mediaPayload);

    expect(result.results[0]?.outcome).toBe('processed');
    expect(fakeMediaProcessingService.processMedia).not.toHaveBeenCalled();
    expect(glpiClient.createTicket).not.toHaveBeenCalled();
    expect(glpiClient.addFollowUp).not.toHaveBeenCalled();
    expect(meta.sendTextMessage).toHaveBeenCalledTimes(1);
    expect(meta.sendTextMessage.mock.calls[0]?.[0].body).toMatch(/apenas texto/);
    expect(meta.sendTextMessage.mock.calls[0]?.[0].body).toContain('1 - Suporte');
    expect(conversationRepository.updatedStatuses).toEqual([]);
    expect(messageRepository.updates[0]).toEqual({
      messageId: 'wamid.media-real-image',
      conversationId: 'conv-awaiting-real-image',
      processingStatus: 'processed',
      glpiSyncStatus: 'synced',
    });
  });

  it('with active routing, GLPI failure after a valid option sends help text, menu, and no pending_glpi on conversation', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    const contactResolutionService = { resolve: vi.fn().mockResolvedValue(resolvedContact) };
    conversationRepository.reusableConversation = {
      id: 'conv-awaiting',
      phoneE164: '+5511999999999',
      contactId: 'contact-1',
      glpiTicketId: null,
      queueId: null,
      status: 'awaiting_queue_selection',
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    messageRepository.reservedMessage = {
      ...(messageRepository.reservedMessage as NonNullable<typeof messageRepository.reservedMessage>),
      messageText: '1',
    };
    const routing = new FakeRoutingRepository();
    routing.options = sampleRoutingOptions;
    const entityMemory = makeEntityMemoryRepository();
    const meta = { sendTextMessage: vi.fn().mockResolvedValue({}) };
    const glpiClient = { createTicket: vi.fn().mockRejectedValue(new Error('GLPI down')), addFollowUp: vi.fn() };

    const glpiFailPayload = structuredClone(basePayload) as typeof basePayload;
    glpiFailPayload.entry[0].changes[0].value.messages[0].text.body = '1';

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
      { routing, meta, entityMemory },
    );

    const result = await service.process(glpiFailPayload);

    expect(result.results[0]?.outcome).toBe('processed');
    expect(conversationRepository.updatedStatuses.filter((u) => u.status === 'pending_glpi')).toEqual([]);
    expect(conversationRepository.linkedTickets).toEqual([]);
    expect(meta.sendTextMessage).toHaveBeenCalledTimes(1);
    expect(meta.sendTextMessage.mock.calls[0]?.[0].body).toMatch(/instabilidade/);
    expect(meta.sendTextMessage.mock.calls[0]?.[0].body).toContain('1 - Suporte');
    expect(meta.sendTextMessage.mock.calls[0]?.[0].body).toContain('\n\n');
    expect(messageRepository.updates[0]).toEqual({
      messageId: 'wamid.123',
      conversationId: 'conv-awaiting',
      processingStatus: 'processed',
      glpiSyncStatus: 'error',
    });
  });

  it('with active routing, a valid option after an invalid one creates only one ticket', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    const contactResolutionService = { resolve: vi.fn().mockResolvedValue(resolvedContact) };
    conversationRepository.reusableConversation = {
      id: 'conv-awaiting',
      phoneE164: '+5511999999999',
      contactId: 'contact-1',
      glpiTicketId: null,
      queueId: null,
      status: 'awaiting_queue_selection',
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const routing = new FakeRoutingRepository();
    routing.options = sampleRoutingOptions;
    const entityMemory = makeEntityMemoryRepository();
    const meta = { sendTextMessage: vi.fn().mockResolvedValue({}) };
    const glpiClient = { createTicket: vi.fn().mockResolvedValue(888), addFollowUp: vi.fn() };

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
      { routing, meta, entityMemory },
    );

    const invalidPayload = structuredClone(basePayload) as typeof basePayload;
    invalidPayload.entry[0].changes[0].value.messages[0].id = 'wamid.invalid-first';
    invalidPayload.entry[0].changes[0].value.messages[0].text.body = '99';

    const validPayload = structuredClone(basePayload) as typeof basePayload;
    validPayload.entry[0].changes[0].value.messages[0].id = 'wamid.valid-second';
    validPayload.entry[0].changes[0].value.messages[0].text.body = '1';

    const invalidResult = await service.process(invalidPayload);
    const validResult = await service.process(validPayload);

    expect(invalidResult.results[0]?.outcome).toBe('processed');
    expect(validResult.results[0]?.outcome).toBe('processed');
    expect(glpiClient.createTicket).toHaveBeenCalledTimes(1);
    expect(conversationRepository.linkedTickets).toEqual([
      expect.objectContaining({ conversationId: 'conv-awaiting', ticketId: 888, queueId: 5 }),
    ]);
    expect(meta.sendTextMessage).toHaveBeenCalledTimes(2);
    expect(meta.sendTextMessage.mock.calls[0]?.[0].body).toMatch(/Nao entendi/);
    expect(meta.sendTextMessage.mock.calls[0]?.[0].body).toContain('1 - Suporte');
    expect(meta.sendTextMessage.mock.calls[1]?.[0].body).toContain(
      'Obrigado! Chamado #888 encaminhado ao Suporte.',
    );
  });

  it('recovers pending_glpi without glpi_ticket_id: moves to awaiting_queue_selection, sends menu, no ticket', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    conversationRepository.pendingGlpiOrphanConversation = {
      id: 'orphan-pending',
      phoneE164: '+5511999999999',
      contactId: 'contact-1',
      glpiTicketId: null,
      queueId: null,
      status: 'pending_glpi',
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const contactResolutionService = { resolve: vi.fn().mockResolvedValue(resolvedContact) };
    const routing = new FakeRoutingRepository();
    routing.options = sampleRoutingOptions;
    const schedule = new FakeScheduleService();
    schedule.open = false;
    const meta = { sendTextMessage: vi.fn().mockResolvedValue({}) };
    const glpiClient = { createTicket: vi.fn(), addFollowUp: vi.fn() };

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
      { routing, schedule, meta },
    );

    const result = await service.process(basePayload);

    expect(result.results[0]?.outcome).toBe('processed');
    expect(glpiClient.createTicket).not.toHaveBeenCalled();
    expect(schedule.checked).toBe(0);
    expect(conversationRepository.updatedStatuses).toEqual([
      { conversationId: 'orphan-pending', status: 'awaiting_queue_selection' },
    ]);
    expect(meta.sendTextMessage).toHaveBeenCalledTimes(1);
    expect(meta.sendTextMessage.mock.calls[0]?.[0].body).toContain('1 - Suporte');
  });

  it('media (image) with a closed conversation starts normal routing flow without invalid_media message', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    // Closed conversation: activeConversation is null, guard must not fire
    conversationRepository.latestClosedConversation = {
      id: 'conv-closed',
      phoneE164: '+5511999999999',
      contactId: 'contact-1',
      glpiTicketId: null,
      queueId: null,
      status: 'closed',
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const contactResolutionService = { resolve: vi.fn().mockResolvedValue(resolvedContact) };
    const routing = new FakeRoutingRepository();
    routing.options = sampleRoutingOptions;
    const meta = { sendTextMessage: vi.fn().mockResolvedValue({}) };
    const glpiClient = { createTicket: vi.fn(), addFollowUp: vi.fn() };

    const imagePayload = structuredClone(basePayload) as typeof basePayload;
    imagePayload.entry[0].changes[0].value.messages[0] = {
      id: 'wamid.image-closed',
      from: '5511999999999',
      type: 'image',
    };

    const service = makeInboundService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService,
      glpiClient,
      { routing, meta },
    );

    const result = await service.process(imagePayload);

    expect(result.results[0]?.outcome).toBe('processed');
    expect(glpiClient.createTicket).not.toHaveBeenCalled();
    // Normal routing menu sent â€” guard must NOT have fired
    expect(meta.sendTextMessage).toHaveBeenCalledTimes(1);
    expect(meta.sendTextMessage.mock.calls[0]?.[0].body).not.toMatch(/apenas texto/);
    expect(meta.sendTextMessage.mock.calls[0]?.[0].body).toContain('1 - Suporte');
    // New awaiting_queue_selection conversation created
    expect(conversationRepository.createdCount).toBe(1);
  });

  it('media (audio) in an open conversation is processed as media and does not create ticket', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    conversationRepository.reusableConversation = {
      id: 'conv-open-audio',
      phoneE164: '+5511999999999',
      contactId: 'contact-1',
      glpiTicketId: 654,
      queueId: 5,
      status: 'open',
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const contactResolutionService = { resolve: vi.fn().mockResolvedValue(resolvedContact) };
    const routing = new FakeRoutingRepository();
    routing.options = sampleRoutingOptions;
    const meta = { sendTextMessage: vi.fn().mockResolvedValue({}) };
    const glpiClient = {
      createTicket: vi.fn(),
      addFollowUp: vi.fn().mockResolvedValue(999),
      getTicketStatus: vi.fn().mockResolvedValue('open'),
    };

    const audioPayload = structuredClone(basePayload) as typeof basePayload;
    audioPayload.entry[0].changes[0].value.messages[0] = {
      id: 'wamid.audio-open',
      from: '5511999999999',
      type: 'audio',
      audio: { id: 'meta-audio-open', mime_type: 'audio/ogg' },
    } as never;

    const fakeMediaResult = {
      mediaInfo: {
        status: 'synced',
        provider: 'meta_whatsapp',
        media_id: 'meta-audio-open',
        message_type: 'audio',
        mime_type: 'audio/ogg',
        download_content_type: 'audio/ogg',
        file_name: 'audio.ogg',
        file_size: 4096,
        caption: null,
        glpi_document_id: 64,
        glpi_ticket_id: 654,
        error: null,
        processed_at: '2026-04-26T00:00:00.000Z',
      },
      followUpContent: '[WhatsApp] Cliente enviou uma midia: audio.ogg (audio/ogg, 4.0 KB).',
    };
    const fakeMediaProcessingService = {
      processMedia: vi.fn().mockResolvedValue(fakeMediaResult),
    };

    const service = new InboundWebhookService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService as never,
      glpiClient as never,
      new FakeKeyLock(),
      routing,
      new FakeSettingsService(),
      new FakeScheduleService(),
      meta as never,
      fakeMediaProcessingService,
    );

    const result = await service.process(audioPayload);

    expect(result.results[0]?.outcome).toBe('processed');
    expect(glpiClient.createTicket).not.toHaveBeenCalled();
    expect(meta.sendTextMessage).not.toHaveBeenCalled();
    expect(fakeMediaProcessingService.processMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        messageType: 'audio',
        mediaMetadata: {
          mediaId: 'meta-audio-open',
          mimeTypeFromWebhook: 'audio/ogg',
          fileName: null,
          caption: null,
        },
        ticketId: 654,
      }),
    );
    expect(glpiClient.addFollowUp).toHaveBeenCalledTimes(1);
    expect(glpiClient.addFollowUp).toHaveBeenCalledWith({
      ticketId: 654,
      content: fakeMediaResult.followUpContent,
    });
    expect(messageRepository.mediaInfoUpdates[0]?.mediaInfo).toMatchObject({
      status: 'synced',
      media_id: 'meta-audio-open',
      glpi_document_id: 64,
    });
    expect(messageRepository.updates[0]).toEqual({
      messageId: 'wamid.audio-open',
      conversationId: 'conv-open-audio',
      processingStatus: 'processed',
      glpiSyncStatus: 'synced',
    });
  });

  it('media (video) in an open conversation is processed as media and attached to the GLPI ticket', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    conversationRepository.reusableConversation = {
      id: 'conv-open-video',
      phoneE164: '+5511999999999',
      contactId: 'contact-1',
      glpiTicketId: 655,
      queueId: 5,
      status: 'open',
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const contactResolutionService = { resolve: vi.fn().mockResolvedValue(resolvedContact) };
    const routing = new FakeRoutingRepository();
    routing.options = sampleRoutingOptions;
    const meta = { sendTextMessage: vi.fn().mockResolvedValue({}) };
    const glpiClient = {
      createTicket: vi.fn(),
      addFollowUp: vi.fn().mockResolvedValue(999),
      getTicketStatus: vi.fn().mockResolvedValue('open'),
    };

    const videoPayload = structuredClone(basePayload) as typeof basePayload;
    videoPayload.entry[0].changes[0].value.messages[0] = {
      id: 'wamid.video-open',
      from: '5511999999999',
      type: 'video',
      video: { id: 'meta-video-open', mime_type: 'video/mp4', caption: 'erro em tela' },
    } as never;

    const fakeMediaResult = {
      mediaInfo: {
        status: 'synced',
        provider: 'meta_whatsapp',
        media_id: 'meta-video-open',
        message_type: 'video',
        mime_type: 'video/mp4',
        download_content_type: 'video/mp4',
        file_name: 'video.mp4',
        file_size: 8192,
        caption: 'erro em tela',
        glpi_document_id: 65,
        glpi_ticket_id: 655,
        error: null,
        processed_at: '2026-04-26T00:00:00.000Z',
      },
      followUpContent: '[WhatsApp] Cliente enviou uma midia: video.mp4 (video/mp4, 8.0 KB).',
    };
    const fakeMediaProcessingService = {
      processMedia: vi.fn().mockResolvedValue(fakeMediaResult),
    };

    const service = new InboundWebhookService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService as never,
      glpiClient as never,
      new FakeKeyLock(),
      routing,
      new FakeSettingsService(),
      new FakeScheduleService(),
      meta as never,
      fakeMediaProcessingService,
    );

    await service.process(videoPayload);

    expect(fakeMediaProcessingService.processMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        messageType: 'video',
        mediaMetadata: {
          mediaId: 'meta-video-open',
          mimeTypeFromWebhook: 'video/mp4',
          fileName: null,
          caption: 'erro em tela',
        },
        ticketId: 655,
      }),
    );
    expect(glpiClient.addFollowUp).toHaveBeenCalledWith({
      ticketId: 655,
      content: fakeMediaResult.followUpContent,
    });
    expect(messageRepository.mediaInfoUpdates[0]?.mediaInfo).toMatchObject({
      status: 'synced',
      media_id: 'meta-video-open',
      glpi_document_id: 65,
    });
    expect(messageRepository.updates[0]).toEqual({
      messageId: 'wamid.video-open',
      conversationId: 'conv-open-video',
      processingStatus: 'processed',
      glpiSyncStatus: 'synced',
    });
  });

  it('8.0C: media with mediaMetadata in open conversation triggers MediaProcessingService and persists media_info', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    conversationRepository.reusableConversation = {
      id: 'conv-open-img',
      phoneE164: '+5511999999999',
      contactId: 'contact-1',
      glpiTicketId: 789,
      queueId: 5,
      status: 'open',
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const contactResolutionService = { resolve: vi.fn().mockResolvedValue(resolvedContact) };
    const routing = new FakeRoutingRepository();
    routing.options = sampleRoutingOptions;
    const meta = { sendTextMessage: vi.fn().mockResolvedValue({}) };
    const glpiClient = {
      createTicket: vi.fn(),
      addFollowUp: vi.fn().mockResolvedValue(111),
      getTicketStatus: vi.fn().mockResolvedValue('open'),
    };

    const fakeMediaResult = {
      mediaInfo: {
        status: 'synced',
        provider: 'meta_whatsapp',
        media_id: 'meta-img-id-999',
        message_type: 'image',
        mime_type: 'image/jpeg',
        download_content_type: 'image/jpeg',
        file_name: 'image.jpg',
        file_size: 51200,
        caption: null,
        glpi_document_id: 42,
        glpi_ticket_id: 789,
        error: null,
        processed_at: '2026-04-26T00:00:00.000Z',
      },
      followUpContent: '[WhatsApp] Cliente enviou uma mÃ­dia: image.jpg (image/jpeg, 50.0 KB).',
    };
    const fakeMediaProcessingService = {
      processMedia: vi.fn().mockResolvedValue(fakeMediaResult),
    };

    const imagePayload = structuredClone(basePayload) as typeof basePayload;
    imagePayload.entry[0].changes[0].value.messages[0] = {
      id: 'wamid.img-media',
      from: '5511999999999',
      type: 'image',
      image: { id: 'meta-img-id-999', mime_type: 'image/jpeg' },
    } as never;

    const service = new InboundWebhookService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService as never,
      glpiClient as never,
      new FakeKeyLock(),
      routing,
      new FakeSettingsService(),
      new FakeScheduleService(),
      meta as never,
      fakeMediaProcessingService,
    );

    const result = await service.process(imagePayload);

    expect(result.results[0]?.outcome).toBe('processed');
    expect(glpiClient.createTicket).not.toHaveBeenCalled();
    expect(meta.sendTextMessage).not.toHaveBeenCalled();
    expect(fakeMediaProcessingService.processMedia).toHaveBeenCalledTimes(1);
    expect(fakeMediaProcessingService.processMedia).toHaveBeenCalledWith(
      expect.objectContaining({ messageType: 'image', ticketId: 789 }),
    );
    expect(glpiClient.addFollowUp).toHaveBeenCalledWith({
      ticketId: 789,
      content: fakeMediaResult.followUpContent,
    });
    expect(messageRepository.mediaInfoUpdates).toHaveLength(1);
    expect(messageRepository.mediaInfoUpdates[0]?.mediaInfo).toMatchObject({
      status: 'synced',
      glpi_document_id: 42,
    });
    expect(messageRepository.updates[0]).toMatchObject({
      messageId: 'wamid.img-media',
      conversationId: 'conv-open-img',
      processingStatus: 'processed',
      glpiSyncStatus: 'synced',
    });
  });

  it('8.0C: document payload in open conversation preserves raw media metadata before processing', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    conversationRepository.reusableConversation = {
      id: 'conv-open-doc-real',
      phoneE164: '+5511999999999',
      contactId: 'contact-1',
      glpiTicketId: 901,
      queueId: 5,
      status: 'open',
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const contactResolutionService = { resolve: vi.fn().mockResolvedValue(resolvedContact) };
    const glpiClient = {
      createTicket: vi.fn(),
      addFollowUp: vi.fn().mockResolvedValue(333),
      getTicketStatus: vi.fn().mockResolvedValue('open'),
    };
    const fakeMediaResult = {
      mediaInfo: {
        status: 'synced',
        provider: 'meta_whatsapp',
        media_id: 'meta-doc-real-id',
        message_type: 'document',
        mime_type: 'application/pdf',
        download_content_type: 'application/pdf',
        file_name: 'contrato.pdf',
        file_size: 2048,
        caption: 'contrato',
        glpi_document_id: 90,
        glpi_ticket_id: 901,
        error: null,
        processed_at: '2026-04-26T00:00:00.000Z',
      },
      followUpContent: '[WhatsApp] Cliente enviou uma mÃ­dia: contrato.pdf (application/pdf, 2.0 KB).',
    };
    const fakeMediaProcessingService = {
      processMedia: vi.fn().mockResolvedValue(fakeMediaResult),
    };

    const docPayload = structuredClone(basePayload) as typeof basePayload;
    docPayload.entry[0].changes[0].value.messages[0] = {
      id: 'wamid.doc-real',
      from: '5511999999999',
      type: 'document',
      document: {
        id: 'meta-doc-real-id',
        mime_type: 'application/pdf',
        filename: 'contrato.pdf',
        caption: 'contrato',
      },
    } as never;

    const service = new InboundWebhookService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService as never,
      glpiClient as never,
      new FakeKeyLock(),
      new FakeRoutingRepository(),
      new FakeSettingsService(),
      new FakeScheduleService(),
      { sendTextMessage: vi.fn().mockResolvedValue({}) } as never,
      fakeMediaProcessingService,
    );

    const result = await service.process(docPayload);

    expect(result.results[0]?.outcome).toBe('processed');
    expect(fakeMediaProcessingService.processMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        messageType: 'document',
        mediaMetadata: {
          mediaId: 'meta-doc-real-id',
          mimeTypeFromWebhook: 'application/pdf',
          fileName: 'contrato.pdf',
          caption: 'contrato',
        },
        ticketId: 901,
      }),
    );
    expect(messageRepository.reservedInputs[0]?.rawPayload).toMatchObject({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    type: 'document',
                    document: {
                      id: 'meta-doc-real-id',
                      mime_type: 'application/pdf',
                      filename: 'contrato.pdf',
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(messageRepository.mediaInfoUpdates[0]?.mediaInfo).toMatchObject({
      status: 'synced',
      media_id: 'meta-doc-real-id',
      glpi_document_id: 90,
    });
  });

  it('8.1: document upload OK but Document_Item permission denied is preserved as uploaded_unlinked', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    conversationRepository.reusableConversation = {
      id: 'conv-open-doc-unlinked',
      phoneE164: '+5511999999999',
      contactId: 'contact-1',
      glpiTicketId: 2112319214,
      queueId: 5,
      status: 'open',
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const contactResolutionService = { resolve: vi.fn().mockResolvedValue(resolvedContact) };
    const glpiClient = {
      createTicket: vi.fn(),
      addFollowUp: vi.fn().mockResolvedValue(334),
      getTicketStatus: vi.fn().mockResolvedValue('open'),
    };
    const fakeMediaResult = {
      mediaInfo: {
        status: 'uploaded_unlinked',
        provider: 'meta_whatsapp',
        media_id: 'meta-doc-unlinked-id',
        message_type: 'document',
        mime_type: 'application/pdf',
        download_content_type: 'application/pdf',
        file_name: 'contrato.pdf',
        file_size: 2048,
        caption: null,
        glpi_document_id: 3844,
        glpi_ticket_id: 2112319214,
        error: 'GLPI request failed for /Document_Item.',
        error_code: 'GLPI_DOCUMENT_ITEM_PERMISSION_DENIED',
        error_stage: 'glpi_document_item_link',
        processed_at: '2026-04-26T00:00:00.000Z',
      },
      followUpContent: '[WhatsApp] Mídia recebida: contrato.pdf — documento enviado ao GLPI, mas não foi possível vincular automaticamente ao chamado.',
    };
    const fakeMediaProcessingService = {
      processMedia: vi.fn().mockResolvedValue(fakeMediaResult),
    };

    const docPayload = structuredClone(basePayload) as typeof basePayload;
    docPayload.entry[0].changes[0].value.messages[0] = {
      id: 'wamid.doc-unlinked',
      from: '5511999999999',
      type: 'document',
      document: {
        id: 'meta-doc-unlinked-id',
        mime_type: 'application/pdf',
        filename: 'contrato.pdf',
      },
    } as never;

    const service = new InboundWebhookService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService as never,
      glpiClient as never,
      new FakeKeyLock(),
      new FakeRoutingRepository(),
      new FakeSettingsService(),
      new FakeScheduleService(),
      { sendTextMessage: vi.fn().mockResolvedValue({}) } as never,
      fakeMediaProcessingService,
    );

    const result = await service.process(docPayload);

    expect(result.results[0]?.outcome).toBe('processed');
    expect(glpiClient.addFollowUp).toHaveBeenCalledWith({
      ticketId: 2112319214,
      content: fakeMediaResult.followUpContent,
    });
    expect(messageRepository.mediaInfoUpdates[0]?.mediaInfo).toMatchObject({
      status: 'uploaded_unlinked',
      glpi_document_id: 3844,
      error_code: 'GLPI_DOCUMENT_ITEM_PERMISSION_DENIED',
      error_stage: 'glpi_document_item_link',
    });
    expect(messageRepository.updates[0]).toMatchObject({
      messageId: 'wamid.doc-unlinked',
      conversationId: 'conv-open-doc-unlinked',
      processingStatus: 'processed',
      glpiSyncStatus: 'synced',
    });
  });

  it('8.0C: detectable media without Meta media metadata is not marked synced', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    conversationRepository.reusableConversation = {
      id: 'conv-open-doc-missing-meta',
      phoneE164: '+5511999999999',
      contactId: 'contact-1',
      glpiTicketId: 902,
      queueId: 5,
      status: 'open',
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const contactResolutionService = { resolve: vi.fn().mockResolvedValue(resolvedContact) };
    const glpiClient = {
      createTicket: vi.fn(),
      addFollowUp: vi.fn(),
      getTicketStatus: vi.fn().mockResolvedValue('open'),
    };
    const fakeMediaProcessingService = {
      processMedia: vi.fn(),
    };

    const docPayload = structuredClone(basePayload) as typeof basePayload;
    docPayload.entry[0].changes[0].value.messages[0] = {
      id: 'wamid.doc-missing-meta',
      from: '5511999999999',
      type: 'document',
    } as never;

    const service = new InboundWebhookService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService as never,
      glpiClient as never,
      new FakeKeyLock(),
      new FakeRoutingRepository(),
      new FakeSettingsService(),
      new FakeScheduleService(),
      { sendTextMessage: vi.fn().mockResolvedValue({}) } as never,
      fakeMediaProcessingService,
    );

    const result = await service.process(docPayload);

    expect(result.results[0]?.outcome).toBe('failed');
    expect(fakeMediaProcessingService.processMedia).not.toHaveBeenCalled();
    expect(glpiClient.addFollowUp).not.toHaveBeenCalled();
    expect(messageRepository.mediaInfoUpdates).toHaveLength(1);
    expect(messageRepository.mediaInfoUpdates[0]?.mediaInfo).toMatchObject({
      status: 'error',
      stage: 'metadata_missing',
      media_id: 'unknown',
      glpi_ticket_id: 902,
      error: {
        code: 'MEDIA_METADATA_MISSING',
      },
    });
    expect(messageRepository.updates[0]).toMatchObject({
      messageId: 'wamid.doc-missing-meta',
      conversationId: 'conv-open-doc-missing-meta',
      processingStatus: 'failed',
      glpiSyncStatus: 'error',
    });
  });

  it('8.0C: persists media_info before followup and preserves document metadata when followup fails', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    conversationRepository.reusableConversation = {
      id: 'conv-open-img-followup-fail',
      phoneE164: '+5511999999999',
      contactId: 'contact-1',
      glpiTicketId: 790,
      queueId: 5,
      status: 'open',
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const contactResolutionService = { resolve: vi.fn().mockResolvedValue(resolvedContact) };
    const routing = new FakeRoutingRepository();
    routing.options = sampleRoutingOptions;
    const meta = { sendTextMessage: vi.fn().mockResolvedValue({}) };
    const glpiClient = {
      createTicket: vi.fn(),
      addFollowUp: vi.fn().mockRejectedValue(new Error('GLPI followup timeout')),
      getTicketStatus: vi.fn().mockResolvedValue('open'),
    };

    const fakeMediaResult = {
      mediaInfo: {
        status: 'synced',
        provider: 'meta_whatsapp',
        media_id: 'meta-img-id-1000',
        message_type: 'image',
        mime_type: 'image/jpeg',
        download_content_type: 'image/jpeg',
        file_name: 'image.jpg',
        file_size: 51200,
        caption: 'foto',
        glpi_document_id: 43,
        glpi_ticket_id: 790,
        error: null,
        processed_at: '2026-04-26T00:00:00.000Z',
      },
      followUpContent: '[WhatsApp] Cliente enviou uma mÃ­dia: image.jpg (image/jpeg, 50.0 KB).',
    };
    const fakeMediaProcessingService = {
      processMedia: vi.fn().mockResolvedValue(fakeMediaResult),
    };

    const imagePayload = structuredClone(basePayload) as typeof basePayload;
    imagePayload.entry[0].changes[0].value.messages[0] = {
      id: 'wamid.img-media-followup-fail',
      from: '5511999999999',
      type: 'image',
      image: { id: 'meta-img-id-1000', mime_type: 'image/jpeg' },
    } as never;

    const service = new InboundWebhookService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService as never,
      glpiClient as never,
      new FakeKeyLock(),
      routing,
      new FakeSettingsService(),
      new FakeScheduleService(),
      meta as never,
      fakeMediaProcessingService,
    );

    const result = await service.process(imagePayload);

    expect(result.results[0]?.outcome).toBe('failed');
    expect(messageRepository.mediaInfoUpdates).toHaveLength(2);
    expect(messageRepository.mediaInfoUpdates[0]?.mediaInfo).toMatchObject({
      status: 'synced',
      glpi_document_id: 43,
      glpi_ticket_id: 790,
    });
    expect(messageRepository.mediaInfoUpdates[1]?.mediaInfo).toMatchObject({
      status: 'error',
      stage: 'followup_failed',
      glpi_document_id: 43,
      glpi_ticket_id: 790,
      error: {
        code: 'GLPI_FOLLOWUP_FAILED',
        message: 'GLPI followup timeout',
      },
    });
    expect(messageRepository.updates[0]).toMatchObject({
      messageId: 'wamid.img-media-followup-fail',
      conversationId: 'conv-open-img-followup-fail',
      processingStatus: 'failed',
      glpiSyncStatus: 'error',
    });
  });

  it('8.0C: media processing error falls back to text followup without breaking the flow', async () => {
    const webhookEventRepository = new FakeWebhookEventRepository();
    const messageRepository = new FakeMessageRepository();
    const conversationRepository = new FakeConversationRepository();
    conversationRepository.reusableConversation = {
      id: 'conv-open-doc',
      phoneE164: '+5511999999999',
      contactId: 'contact-1',
      glpiTicketId: 900,
      queueId: 5,
      status: 'open',
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const contactResolutionService = { resolve: vi.fn().mockResolvedValue(resolvedContact) };
    const glpiClient = {
      createTicket: vi.fn(),
      addFollowUp: vi.fn().mockResolvedValue(222),
      getTicketStatus: vi.fn().mockResolvedValue('open'),
    };

    const fakeMediaResult = {
      mediaInfo: {
        status: 'error',
        provider: 'meta_whatsapp',
        media_id: 'meta-doc-id-err',
        message_type: 'document',
        mime_type: 'application/pdf',
        download_content_type: null,
        file_name: 'document.pdf',
        file_size: 0,
        caption: null,
        glpi_document_id: null,
        glpi_ticket_id: 900,
        error: 'Meta media download failed.',
        processed_at: '2026-04-26T00:00:00.000Z',
      },
      followUpContent: '[WhatsApp] MÃ­dia recebida: [document (application/pdf)] â€” falha no processamento.',
    };
    const fakeMediaProcessingService = {
      processMedia: vi.fn().mockResolvedValue(fakeMediaResult),
    };

    const docPayload = structuredClone(basePayload) as typeof basePayload;
    docPayload.entry[0].changes[0].value.messages[0] = {
      id: 'wamid.doc-err',
      from: '5511999999999',
      type: 'document',
      document: { id: 'meta-doc-id-err', mime_type: 'application/pdf', filename: 'relatorio.pdf' },
    } as never;

    const service = new InboundWebhookService(
      webhookEventRepository,
      messageRepository,
      conversationRepository,
      contactResolutionService as never,
      glpiClient as never,
      new FakeKeyLock(),
      new FakeRoutingRepository(),
      new FakeSettingsService(),
      new FakeScheduleService(),
      { sendTextMessage: vi.fn().mockResolvedValue({}) } as never,
      fakeMediaProcessingService,
    );

    const result = await service.process(docPayload);

    expect(result.results[0]?.outcome).toBe('processed');
    expect(glpiClient.addFollowUp).toHaveBeenCalledWith({
      ticketId: 900,
      content: fakeMediaResult.followUpContent,
    });
    // media_info persisted even on error
    expect(messageRepository.mediaInfoUpdates).toHaveLength(1);
    expect(messageRepository.mediaInfoUpdates[0]?.mediaInfo).toMatchObject({
      status: 'error',
      glpi_document_id: null,
    });
    expect(result.results[0]?.outcome).toBe('processed');
  });
});
