import { describe, expect, it, vi } from 'vitest';

import type { GlpiClient } from '../src/adapters/glpi/GlpiClient.js';
import type { Conversation } from '../src/domain/entities/Conversation.js';
import type { InboundMessage } from '../src/domain/entities/InboundMessage.js';
import type {
  ContactEntityMemory,
  ContactEntityMemoryRepository,
  RememberContactEntityInput,
} from '../src/domain/repositories/ContactEntityMemoryRepository.js';
import {
  EntitySelectionError,
  EntitySelectionService,
  hasValidGlpiTicketId,
} from '../src/domain/services/EntitySelectionService.js';
import type {
  ConversationRepository,
  CreateConversationInput,
  EntitySelectionAttempt,
  EntitySelectionAttemptReserveResult,
} from '../src/repositories/contracts/ConversationRepository.js';
import type {
  InsertOutboundMessageInput,
  InsertedOutboundMessage,
  MessageRepository,
  RecordDeliveryStatusInput,
  RecordDeliveryStatusResult,
  ReserveInboundMessageInput,
  UpdateMessageStateInput,
} from '../src/repositories/contracts/MessageRepository.js';
import type { RoutingRepository } from '../src/repositories/contracts/RoutingRepository.js';
import { GlpiRequestError } from '../src/errors/GlpiRequestError.js';

function createConversation(overrides: Partial<Conversation> = {}): Conversation {
  const now = new Date('2026-05-12T00:00:00.000Z');
  return {
    id: 'conv-1',
    phoneE164: '+5511999999999',
    contactId: 'contact-1',
    glpiTicketId: null,
    queueId: 1,
    status: 'awaiting_entity_selection',
    lastMessageAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

class FakeConversationRepository implements ConversationRepository {
  public attempts = new Map<string, EntitySelectionAttempt>();
  public linked: Array<{
    conversationId: string;
    ticketId: number;
    queueId?: number | null;
    glpiEntityId?: number | null;
    glpiEntityName?: string | null;
  }> = [];
  public failedBeforeTicket: Array<{ attemptId: string; errorMessage: string }> = [];
  public reservedEntities: Array<{
    conversationId: string;
    glpiEntityId: number;
    glpiEntityName: string | null;
    idempotencyKey: string | null;
  }> = [];

  public constructor(public conversation: Conversation | null) {}

  public async findReusableByPhoneE164(): Promise<Conversation | null> {
    return null;
  }

  public async findPendingGlpiOrphanByPhoneE164(): Promise<Conversation | null> {
    return null;
  }

  public async findLatestClosedByPhoneE164(): Promise<Conversation | null> {
    return null;
  }

  public async findById(): Promise<Conversation | null> {
    return this.conversation;
  }

  public async findByIdAndGlpiTicketId(): Promise<Conversation | null> {
    return null;
  }

  public async create(_input: CreateConversationInput): Promise<Conversation> {
    throw new Error('not used');
  }

  public async linkGlpiTicket(
    conversationId: string,
    ticketId: number,
    queueId?: number | null,
    glpiEntityId?: number | null,
    glpiEntityName?: string | null,
  ): Promise<boolean> {
    this.linked.push({ conversationId, ticketId, queueId, glpiEntityId, glpiEntityName });
    if (this.conversation) {
      this.conversation = {
        ...this.conversation,
        status: 'open',
        glpiTicketId: ticketId,
        glpiEntityId: glpiEntityId ?? this.conversation.glpiEntityId ?? null,
        glpiEntityName: glpiEntityName ?? this.conversation.glpiEntityName ?? null,
      };
    }
    return true;
  }

  public async updateStatus(): Promise<void> {}

  public async updateQueueAndStatus(): Promise<void> {}

  public async updateProfileCollectionState(): Promise<void> {}

  public async reopenConversation(): Promise<void> {}

  public async touch(): Promise<void> {}

  public async reserveEntitySelectionAttempt(
    conversationId: string,
    glpiEntityId: number,
    glpiEntityName?: string | null,
    idempotencyKey?: string | null,
  ): Promise<EntitySelectionAttemptReserveResult> {
    this.reservedEntities.push({
      conversationId,
      glpiEntityId,
      glpiEntityName: glpiEntityName ?? null,
      idempotencyKey: idempotencyKey ?? null,
    });
    const existing = this.attempts.get(conversationId);
    if (existing) {
      return { wasCreated: false, attempt: existing };
    }

    const attempt: EntitySelectionAttempt = {
      id: 'attempt-1',
      conversationId,
      idempotencyKey: idempotencyKey ?? null,
      status: 'processing',
      glpiEntityId,
      glpiEntityName: glpiEntityName ?? null,
      glpiTicketId: null,
      errorMessage: null,
      createdAt: new Date('2026-05-12T00:00:00.000Z'),
      updatedAt: new Date('2026-05-12T00:00:00.000Z'),
      finishedAt: null,
    };
    this.attempts.set(conversationId, attempt);
    return { wasCreated: true, attempt };
  }

  public async findEntitySelectionAttemptByConversationId(conversationId: string): Promise<EntitySelectionAttempt | null> {
    return this.attempts.get(conversationId) ?? null;
  }

  public async markEntitySelectionAttemptSucceeded(attemptId: string, glpiTicketId: number): Promise<void> {
    const attempt = [...this.attempts.values()].find((item) => item.id === attemptId);
    if (attempt) {
      attempt.status = 'succeeded';
      attempt.glpiTicketId = glpiTicketId;
      attempt.finishedAt = new Date('2026-05-12T00:00:30.000Z');
    }
  }

  public async markEntitySelectionAttemptFailedBeforeTicket(
    attemptId: string,
    errorMessage: string,
  ): Promise<void> {
    this.failedBeforeTicket.push({ attemptId, errorMessage });
    const attempt = [...this.attempts.values()].find((item) => item.id === attemptId);
    if (attempt) {
      attempt.status = 'failed_before_ticket';
      attempt.errorMessage = errorMessage;
      attempt.finishedAt = new Date('2026-05-12T00:00:30.000Z');
    }
  }

  public async markEntitySelectionAttemptFailedAfterTicket(
    attemptId: string,
    glpiTicketId: number,
    errorMessage: string,
  ): Promise<void> {
    const attempt = [...this.attempts.values()].find((item) => item.id === attemptId);
    if (attempt) {
      attempt.status = 'failed_after_ticket';
      attempt.glpiTicketId = glpiTicketId;
      attempt.errorMessage = errorMessage;
      attempt.finishedAt = new Date('2026-05-12T00:00:30.000Z');
    }
  }
}

class FakeMessageRepository implements MessageRepository {
  public async reserveInbound(_input: ReserveInboundMessageInput): Promise<InboundMessage | null> {
    return null;
  }

  public async findByMessageId(): Promise<InboundMessage | null> {
    return null;
  }

  public async findByIdempotencyKey(): Promise<InboundMessage | null> {
    return null;
  }

  public async findByConversationId(): Promise<InboundMessage[]> {
    return [{
      id: 'msg-1',
      conversationId: 'conv-1',
      messageId: 'wa-1',
      direction: 'inbound',
      senderPhone: '+5511999999999',
      recipientPhone: '+5511888888888',
      messageType: 'text',
      messageText: 'Preciso de ajuda',
      rawPayload: {},
      mediaInfo: null,
      processingStatus: 'processed',
      glpiSyncStatus: 'synced',
      metaMessageId: null,
      deliveryStatus: null,
      deliveryStatusUpdatedAt: null,
      metaErrorCode: null,
      metaErrorMessageSanitized: null,
      createdAt: new Date('2026-05-12T00:00:00.000Z'),
      updatedAt: new Date('2026-05-12T00:00:00.000Z'),
    }];
  }

  public async insertOutbound(_input: InsertOutboundMessageInput): Promise<InsertedOutboundMessage> {
    throw new Error('not used');
  }

  public async recordDeliveryStatus(input: RecordDeliveryStatusInput): Promise<RecordDeliveryStatusResult> {
    return { matched: true, insertedEvent: true, currentStatus: input.status };
  }

  public async updateState(_input: UpdateMessageStateInput): Promise<void> {}

  public async updateMediaInfo(): Promise<void> {}
}

class FakeRoutingRepository implements RoutingRepository {
  public async getActiveOptions() {
    return [];
  }

  public async findAssignmentByQueueId() {
    return {
      routingOptionId: 1,
      queueId: 1,
      glpiGroupId: 8,
      glpiUserId: null,
    };
  }
}

class FakeContactEntityMemoryRepository implements ContactEntityMemoryRepository {
  public remembers: RememberContactEntityInput[] = [];
  public activeMemory: ContactEntityMemory | null = null;

  public async findActiveByPhone(): Promise<ContactEntityMemory | null> {
    return this.activeMemory;
  }

  public async rememberEntityForPhone(input: RememberContactEntityInput): Promise<ContactEntityMemory> {
    this.remembers.push(input);
    return {
      id: 'memory-1',
      phoneE164: input.phoneE164,
      contactId: input.contactId ?? null,
      glpiEntityId: input.glpiEntityId,
      glpiEntityName: input.glpiEntityName ?? null,
      sourceTicketId: input.sourceTicketId ?? null,
      sourceConversationId: input.sourceConversationId ?? null,
      source: input.source ?? 'manual',
      isActive: true,
      createdAt: new Date('2026-05-12T00:00:00.000Z'),
      updatedAt: new Date('2026-05-12T00:00:00.000Z'),
    };
  }
}

function createService(
  conversation: Conversation | null,
  outboundMessageService: { send: ReturnType<typeof vi.fn> } | null = null,
  options: { processTicketCreationInline?: boolean; messageConfigurationService?: unknown } = {},
) {
  const conversationRepository = new FakeConversationRepository(conversation);
  const messageRepository = new FakeMessageRepository();
  const routingRepository = new FakeRoutingRepository();
  const glpiClient = {
    createTicket: vi.fn().mockResolvedValue(2112319281),
    findTicketForEntitySelection: vi.fn().mockResolvedValue(null),
    findTicketsForEntitySelection: vi.fn().mockResolvedValue([]),
  } as unknown as GlpiClient;
  const memoryRepository = new FakeContactEntityMemoryRepository();
  const service = new EntitySelectionService(
    conversationRepository,
    messageRepository,
    routingRepository,
    glpiClient,
    memoryRepository,
    outboundMessageService,
    null,
    {
      processTicketCreationInline: options.processTicketCreationInline ?? true,
      messageConfigurationService: options.messageConfigurationService as never,
    },
  );

  return { service, conversationRepository, glpiClient, memoryRepository, outboundMessageService };
}

describe('EntitySelectionService', () => {
  it('normalizes GLPI ticket ids semantically', () => {
    expect(hasValidGlpiTicketId(null)).toBe(false);
    expect(hasValidGlpiTicketId(undefined)).toBe(false);
    expect(hasValidGlpiTicketId(0)).toBe(false);
    expect(hasValidGlpiTicketId('0')).toBe(false);
    expect(hasValidGlpiTicketId('')).toBe(false);
    expect(hasValidGlpiTicketId(Number.NaN)).toBe(false);
    expect(hasValidGlpiTicketId(-1)).toBe(false);
    expect(hasValidGlpiTicketId(10.5)).toBe(false);
    expect(hasValidGlpiTicketId('abc')).toBe(false);
    expect(hasValidGlpiTicketId(2112319281)).toBe(true);
    expect(hasValidGlpiTicketId('2112319281')).toBe(true);
  });

  it('blocks create_ticket=false when pending conversation has glpiTicketId=0', async () => {
    const { service, glpiClient, memoryRepository } = createService(createConversation({ glpiTicketId: 0 }));

    await expect(service.confirmEntity({
      conversationId: 'conv-1',
      glpiEntityId: 119,
      createTicket: false,
    })).rejects.toMatchObject({
      statusCode: 409,
      errorCode: 'TICKET_REQUIRED',
    } satisfies Partial<EntitySelectionError>);

    expect(glpiClient.createTicket).not.toHaveBeenCalled();
    expect(memoryRepository.remembers).toHaveLength(0);
  });

  it('rejects missing or zero GLPI entity ids before reserving an attempt', async () => {
    const { service, conversationRepository, glpiClient, memoryRepository } = createService(
      createConversation({ glpiTicketId: 0 }),
    );

    await expect(service.confirmEntity({
      conversationId: 'conv-1',
      glpiEntityId: 0,
      createTicket: true,
    })).rejects.toMatchObject({
      statusCode: 400,
      errorCode: 'INVALID_ENTITY',
    } satisfies Partial<EntitySelectionError>);

    await expect(service.confirmEntity({
      conversationId: 'conv-1',
      glpiEntityId: null as unknown as number,
      createTicket: true,
    })).rejects.toMatchObject({
      statusCode: 400,
      errorCode: 'INVALID_ENTITY',
    } satisfies Partial<EntitySelectionError>);

    expect(conversationRepository.reservedEntities).toEqual([]);
    expect(glpiClient.createTicket).not.toHaveBeenCalled();
    expect(memoryRepository.remembers).toHaveLength(0);
  });

  it('creates and links a ticket before saving memory when glpiTicketId=0', async () => {
    const { service, conversationRepository, glpiClient, memoryRepository } = createService(
      createConversation({ glpiTicketId: 0 }),
    );

    await expect(service.confirmEntity({
      conversationId: 'conv-1',
      glpiEntityId: 119,
      glpiEntityName: 'Cliente (119)',
      glpiUserId: 800,
      createTicket: true,
    })).resolves.toMatchObject({
      status: 'succeeded',
      glpiTicketId: 2112319281,
    });

    expect(glpiClient.createTicket).toHaveBeenCalledTimes(1);
    expect(conversationRepository.reservedEntities).toEqual([{
      conversationId: 'conv-1',
      glpiEntityId: 119,
      glpiEntityName: 'Cliente (119)',
      idempotencyKey: 'entity_selection:conv-1:119',
    }]);
    expect(conversationRepository.linked).toEqual([expect.objectContaining({
      conversationId: 'conv-1',
      ticketId: 2112319281,
      queueId: 1,
    })]);
    expect(memoryRepository.remembers).toEqual([expect.objectContaining({
      phoneE164: '+5511999999999',
      glpiEntityId: 119,
      sourceTicketId: 2112319281,
      sourceConversationId: 'conv-1',
    })]);
  });

  it('preserves an active memory entity name when confirmation arrives without a name', async () => {
    const { service, memoryRepository } = createService(
      createConversation({ glpiTicketId: 0 }),
    );
    memoryRepository.activeMemory = {
      id: 'memory-existing',
      phoneE164: '+5511999999999',
      contactId: 'contact-1',
      glpiEntityId: 119,
      glpiEntityName: 'Cliente Real / Unidade 119',
      sourceTicketId: 100,
      sourceConversationId: 'conv-old',
      source: 'manual',
      isActive: true,
      createdAt: new Date('2026-05-11T00:00:00.000Z'),
      updatedAt: new Date('2026-05-11T00:00:00.000Z'),
    };

    await expect(service.confirmEntity({
      conversationId: 'conv-1',
      glpiEntityId: 119,
      glpiEntityName: '',
      createTicket: true,
    })).resolves.toMatchObject({
      status: 'succeeded',
      glpiTicketId: 2112319281,
    });

    expect(memoryRepository.remembers).toEqual([expect.objectContaining({
      glpiEntityId: 119,
      glpiEntityName: 'Cliente Real / Unidade 119',
    })]);
  });

  it('sends the ticket created notification after manual entity selection succeeds', async () => {
    const outboundMessageService = {
      send: vi.fn().mockResolvedValue({
        httpStatus: 201,
        body: {
          status: 'sent',
          message_id: 'wamid.ticket-created',
          conversation_id: 'conv-1',
          postgres_message_row_id: 'row-1',
          idempotent: false,
        },
      }),
    };
    const messageConfigurationService = {
      getMessage: vi.fn().mockResolvedValue({
        eventKey: 'ticket_created_message',
        group: 'Ticket e Solução',
        description: 'Chamado criado',
        defaultText: 'Fallback #{ticket_id}',
        customText: 'Chamado customizado {{ticket_id}} pronto.',
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
      }),
    };
    const { service } = createService(
      createConversation({ glpiTicketId: 0 }),
      outboundMessageService,
      { messageConfigurationService },
    );

    await expect(service.confirmEntity({
      conversationId: 'conv-1',
      glpiEntityId: 119,
      glpiEntityName: 'Cliente (119)',
      glpiUserId: 800,
      createTicket: true,
    })).resolves.toMatchObject({
      status: 'succeeded',
      glpiTicketId: 2112319281,
    });

    await vi.waitFor(() => {
      expect(outboundMessageService.send).toHaveBeenCalledTimes(1);
    });
    expect(outboundMessageService.send).toHaveBeenCalledWith({
      ticket_id: 2112319281,
      conversation_id: 'conv-1',
      text: 'Chamado customizado 2112319281 pronto.',
      message_type: 'text',
      glpi_user_id: 800,
      idempotency_key: 'ticket_created_entity_selection:conv-1:2112319281',
    });
    expect(messageConfigurationService.getMessage).toHaveBeenCalledWith('ticket_created_message');
  });

  it('keeps ticket and memory when the ticket-created WhatsApp notification fails', async () => {
    const outboundMessageService = {
      send: vi.fn().mockRejectedValue(new Error('Meta unavailable')),
    };
    const { service, conversationRepository, memoryRepository } = createService(
      createConversation({ glpiTicketId: 0 }),
      outboundMessageService,
    );

    await expect(service.confirmEntity({
      conversationId: 'conv-1',
      glpiEntityId: 119,
      createTicket: true,
    })).resolves.toMatchObject({
      status: 'succeeded',
      glpiTicketId: 2112319281,
    });

    expect(conversationRepository.linked).toHaveLength(1);
    expect(memoryRepository.remembers).toHaveLength(1);
    await vi.waitFor(() => {
      expect(outboundMessageService.send).toHaveBeenCalledTimes(1);
    });
  });

  it('does not duplicate the ticket-created notification on retry after success', async () => {
    const outboundMessageService = {
      send: vi.fn().mockResolvedValue({
        httpStatus: 201,
        body: {
          status: 'sent',
          message_id: 'wamid.ticket-created',
          conversation_id: 'conv-1',
          postgres_message_row_id: 'row-1',
          idempotent: false,
        },
      }),
    };
    const { service, glpiClient } = createService(createConversation({ glpiTicketId: 0 }), outboundMessageService);

    await service.confirmEntity({
      conversationId: 'conv-1',
      glpiEntityId: 119,
      createTicket: true,
    });

    await vi.waitFor(() => {
      expect(outboundMessageService.send).toHaveBeenCalledTimes(1);
    });

    await expect(service.confirmEntity({
      conversationId: 'conv-1',
      glpiEntityId: 119,
      createTicket: true,
    })).resolves.toMatchObject({
      status: 'succeeded',
      glpiTicketId: 2112319281,
      idempotent: true,
    });

    expect(glpiClient.createTicket).toHaveBeenCalledTimes(1);
    expect(outboundMessageService.send).toHaveBeenCalledTimes(1);
  });

  it('creates a useful title with queue, company, requester and reason from the profile state', async () => {
    const { service, glpiClient } = createService(createConversation({
      glpiTicketId: 0,
      profileCollectionState: {
        step: 'complete',
        queue_label: 'Suporte Técnico',
        company_name_raw: 'ETICA INFORMATICA',
        requester_name: 'Bruno Baumel',
        reason: 'Problema no Outlook',
      },
    }));

    await service.confirmEntity({
      conversationId: 'conv-1',
      glpiEntityId: 119,
      createTicket: true,
    });

    expect(glpiClient.createTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '[WA][Suporte Técnico] ETICA INFORMATICA — Bruno Baumel — Problema no Outlook',
        content: expect.stringContaining('Nome informado: Bruno Baumel'),
      }),
      { timeoutMs: 45_000 },
    );
    expect(vi.mocked(glpiClient.createTicket).mock.calls[0]?.[0].content).toContain(
      '[IntegraGLPI correlation_id: entity_selection:conv-1:119]',
    );
  });

  it('reconciles an already-linked ticket as success regardless of conversation status', async () => {
    const { service, conversationRepository, glpiClient, memoryRepository } = createService(
      createConversation({ status: 'awaiting_entity_selection', glpiTicketId: 2112319000 }),
    );

    await expect(service.confirmEntity({
      conversationId: 'conv-1',
      glpiEntityId: 119,
      createTicket: true,
    })).resolves.toMatchObject({
      status: 'succeeded',
      glpiTicketId: 2112319000,
      idempotent: true,
    });

    expect(conversationRepository.reservedEntities).toEqual([]);
    expect(glpiClient.createTicket).not.toHaveBeenCalled();
    expect(memoryRepository.remembers).toHaveLength(0);
  });

  it('allows entity selection when contact profile collection is complete but status is still collecting', async () => {
    const { service, conversationRepository, glpiClient, memoryRepository } = createService(
      createConversation({
        status: 'collecting_contact_profile',
        glpiTicketId: null,
        profileCollectionState: {
          step: 'complete',
          company_name_raw: 'Empresa',
          requester_name: 'Maria',
          reason: 'Impressora parada',
        },
      }),
    );

    await expect(service.confirmEntity({
      conversationId: 'conv-1',
      glpiEntityId: 119,
      glpiEntityName: 'Cliente > Unidade',
      createTicket: true,
    })).resolves.toMatchObject({
      status: 'succeeded',
      glpiTicketId: 2112319281,
    });

    expect(glpiClient.createTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        entitiesId: 119,
      }),
      { timeoutMs: 45_000 },
    );
    expect(conversationRepository.linked[0]).toEqual({
      conversationId: 'conv-1',
      ticketId: 2112319281,
      queueId: 1,
      glpiEntityId: 119,
      glpiEntityName: 'Cliente > Unidade',
    });
    expect(memoryRepository.remembers[0]).toMatchObject({
      glpiEntityId: 119,
      glpiEntityName: 'Cliente > Unidade',
    });
  });

  it('does not reserve an attempt or create a ticket when conversation is not awaiting entity selection', async () => {
    const { service, conversationRepository, glpiClient, memoryRepository } = createService(
      createConversation({ status: 'open', glpiTicketId: null }),
    );

    await expect(service.confirmEntity({
      conversationId: 'conv-1',
      glpiEntityId: 119,
      createTicket: true,
    })).rejects.toMatchObject({
      statusCode: 409,
      errorCode: 'CONVERSATION_STATUS_NOT_ALLOWED',
    } satisfies Partial<EntitySelectionError>);

    expect(conversationRepository.reservedEntities).toEqual([]);
    expect(glpiClient.createTicket).not.toHaveBeenCalled();
    expect(memoryRepository.remembers).toHaveLength(0);
  });

  it('uses a sanitized provided idempotency key when confirming an entity', async () => {
    const { service, conversationRepository } = createService(
      createConversation({ glpiTicketId: 0 }),
    );

    await service.confirmEntity({
      conversationId: 'conv-1',
      glpiEntityId: 119,
      createTicket: true,
      idempotencyKey: ' entity_selection:conv-1:119 ',
    });

    expect(conversationRepository.reservedEntities[0]).toMatchObject({
      idempotencyKey: 'entity_selection:conv-1:119',
    });
  });

  it('falls back to deterministic idempotency key when the provided value is unsafe', async () => {
    const { service, conversationRepository } = createService(
      createConversation({ glpiTicketId: 0 }),
    );

    await service.confirmEntity({
      conversationId: 'conv-1',
      glpiEntityId: 119,
      createTicket: true,
      idempotencyKey: 'bad key with spaces',
    });

    expect(conversationRepository.reservedEntities[0]).toMatchObject({
      idempotencyKey: 'entity_selection:conv-1:119',
    });
  });

  it('keeps entity selection recoverable when GLPI initSession times out before ticket creation', async () => {
    const { service, conversationRepository, glpiClient, memoryRepository } = createService(
      createConversation({ glpiTicketId: 0 }),
    );
    vi.mocked(glpiClient.createTicket).mockRejectedValueOnce(new GlpiRequestError(
      'GLPI initSession timed out.',
      undefined,
      {
        error_type: 'timeout',
        error_name: 'AbortError',
        error_message: 'This operation was aborted.',
        error_code: 20,
        timeout_ms: 5000,
      },
      'glpi_init_session',
      'https://glpi.example.local/apirest.php/initSession/',
    ));

    await expect(service.confirmEntity({
      conversationId: 'conv-1',
      glpiEntityId: 119,
      glpiEntityName: 'Cliente (119)',
      createTicket: true,
    })).rejects.toMatchObject({
      statusCode: 502,
      errorCode: 'FAILED_BEFORE_TICKET',
      message: 'Falha ao iniciar sessão no GLPI por timeout. Nenhum ticket foi criado. Tente novamente.',
      details: expect.objectContaining({
        glpi_stage: 'glpi_init_session',
        error_type: 'timeout',
        timeout_ms: 5000,
      }),
    } satisfies Partial<EntitySelectionError>);

    expect(conversationRepository.failedBeforeTicket).toEqual([{
      attemptId: 'attempt-1',
      errorMessage: 'glpi_init_session timeout before ticket creation',
    }]);
    expect(conversationRepository.linked).toEqual([]);
    expect(memoryRepository.remembers).toHaveLength(0);
  });

  it('allows retry after failed_before_ticket without duplicating a ticket', async () => {
    const { service, conversationRepository, glpiClient, memoryRepository } = createService(
      createConversation({ glpiTicketId: 0 }),
    );
    vi.mocked(glpiClient.createTicket)
      .mockRejectedValueOnce(new GlpiRequestError(
        'GLPI initSession timed out.',
        undefined,
        { error_type: 'timeout', timeout_ms: 5000 },
        'glpi_init_session',
        'https://glpi.example.local/apirest.php/initSession/',
      ))
      .mockResolvedValueOnce(2112319282);

    await expect(service.confirmEntity({
      conversationId: 'conv-1',
      glpiEntityId: 119,
      createTicket: true,
    })).rejects.toMatchObject({
      errorCode: 'FAILED_BEFORE_TICKET',
    } satisfies Partial<EntitySelectionError>);

    await expect(service.confirmEntity({
      conversationId: 'conv-1',
      glpiEntityId: 119,
      createTicket: true,
    })).resolves.toMatchObject({
      status: 'succeeded',
      glpiTicketId: 2112319282,
    });

    expect(glpiClient.createTicket).toHaveBeenCalledTimes(2);
    expect(conversationRepository.linked).toEqual([expect.objectContaining({
      conversationId: 'conv-1',
      ticketId: 2112319282,
      queueId: 1,
    })]);
    expect(memoryRepository.remembers).toHaveLength(1);
  });

  it('reconciles a GLPI ticket created before a ticket-create timeout returns', async () => {
    const { service, conversationRepository, glpiClient, memoryRepository } = createService(
      createConversation({ glpiTicketId: 0 }),
    );
    vi.mocked(glpiClient.createTicket).mockRejectedValueOnce(new GlpiRequestError(
      'GLPI request timed out.',
      undefined,
      { error_type: 'timeout', timeout_ms: 45_000 },
      'glpi_ticket_create',
      'https://glpi.example.local/apirest.php/Ticket',
    ));
    vi.mocked(glpiClient.findTicketsForEntitySelection).mockResolvedValueOnce([{
      id: 2112319301,
      status: 1,
      entitiesId: 119,
    }]);

    await expect(service.confirmEntity({
      conversationId: 'conv-1',
      glpiEntityId: 119,
      glpiEntityName: 'Cliente (119)',
      createTicket: true,
    })).resolves.toMatchObject({
      status: 'succeeded',
      glpiTicketId: 2112319301,
      idempotent: true,
      warning: expect.stringContaining('timeout'),
    });

    expect(glpiClient.createTicket).toHaveBeenCalledTimes(1);
    expect(glpiClient.findTicketsForEntitySelection).toHaveBeenCalledWith({
      correlationMarker: '[IntegraGLPI correlation_id: entity_selection:conv-1:119]',
      requesterPhone: '+5511999999999',
      entitiesId: 119,
    });
    expect(conversationRepository.failedBeforeTicket).toEqual([]);
    expect(conversationRepository.linked).toEqual([expect.objectContaining({
      conversationId: 'conv-1',
      ticketId: 2112319301,
      glpiEntityId: 119,
    })]);
    expect(memoryRepository.remembers).toEqual([expect.objectContaining({
      glpiEntityId: 119,
      sourceTicketId: 2112319301,
    })]);
  });

  it('retries a failed_before_ticket attempt by reconciling the existing GLPI ticket first', async () => {
    const { service, conversationRepository, glpiClient, memoryRepository } = createService(
      createConversation({ glpiTicketId: 0 }),
    );
    conversationRepository.attempts.set('conv-1', {
      id: 'attempt-1',
      conversationId: 'conv-1',
      idempotencyKey: 'entity_selection:conv-1:119',
      status: 'failed_before_ticket',
      glpiEntityId: 119,
      glpiEntityName: 'Cliente (119)',
      glpiTicketId: null,
      errorMessage: 'glpi_ticket_create timeout; reconciliation pending',
      createdAt: new Date('2026-05-12T00:00:00.000Z'),
      updatedAt: new Date('2026-05-12T00:00:00.000Z'),
      finishedAt: new Date('2026-05-12T00:00:30.000Z'),
    });
    vi.mocked(glpiClient.findTicketsForEntitySelection).mockResolvedValueOnce([{
      id: 2112319302,
      status: 1,
      entitiesId: 119,
    }]);

    await expect(service.confirmEntity({
      conversationId: 'conv-1',
      glpiEntityId: 119,
      glpiEntityName: 'Cliente (119)',
      createTicket: true,
    })).resolves.toMatchObject({
      status: 'succeeded',
      glpiTicketId: 2112319302,
      idempotent: true,
    });

    expect(glpiClient.createTicket).not.toHaveBeenCalled();
    expect(conversationRepository.linked).toEqual([expect.objectContaining({
      ticketId: 2112319302,
      glpiEntityId: 119,
    })]);
    expect(memoryRepository.remembers).toHaveLength(1);
  });

  it('blocks automatic reconciliation when multiple GLPI ticket candidates are found', async () => {
    const { service, conversationRepository, glpiClient, memoryRepository } = createService(
      createConversation({ glpiTicketId: 0 }),
    );
    conversationRepository.attempts.set('conv-1', {
      id: 'attempt-1',
      conversationId: 'conv-1',
      idempotencyKey: 'entity_selection:conv-1:119',
      status: 'failed_before_ticket',
      glpiEntityId: 119,
      glpiEntityName: 'Cliente (119)',
      glpiTicketId: null,
      errorMessage: 'glpi_ticket_create timeout; reconciliation pending',
      createdAt: new Date('2026-05-12T00:00:00.000Z'),
      updatedAt: new Date('2026-05-12T00:00:00.000Z'),
      finishedAt: new Date('2026-05-12T00:00:30.000Z'),
    });
    vi.mocked(glpiClient.findTicketsForEntitySelection).mockResolvedValueOnce([
      { id: 2112319241, status: 1, entitiesId: 119 },
      { id: 2112319242, status: 1, entitiesId: 119 },
    ]);

    await expect(service.confirmEntity({
      conversationId: 'conv-1',
      glpiEntityId: 119,
      glpiEntityName: 'Cliente (119)',
      createTicket: true,
    })).rejects.toMatchObject({
      statusCode: 409,
      errorCode: 'AMBIGUOUS_RECONCILIATION',
    } satisfies Partial<EntitySelectionError>);

    expect(glpiClient.createTicket).not.toHaveBeenCalled();
    expect(conversationRepository.linked).toEqual([]);
    expect(memoryRepository.remembers).toHaveLength(0);
    expect(conversationRepository.failedBeforeTicket).toEqual([{
      attemptId: 'attempt-1',
      errorMessage: 'ambiguous_reconciliation: 2112319241,2112319242',
    }]);
  });

  it('separates GLPI auth failures from initSession timeouts', async () => {
    const { service, conversationRepository, glpiClient, memoryRepository } = createService(
      createConversation({ glpiTicketId: 0 }),
    );
    vi.mocked(glpiClient.createTicket).mockRejectedValueOnce(new GlpiRequestError(
      'GLPI initSession failed.',
      401,
      { message: 'Unauthorized' },
      'glpi_init_session',
      'https://glpi.example.local/apirest.php/initSession/',
    ));

    await expect(service.confirmEntity({
      conversationId: 'conv-1',
      glpiEntityId: 119,
      createTicket: true,
    })).rejects.toMatchObject({
      statusCode: 502,
      errorCode: 'FAILED_BEFORE_TICKET',
      message: 'Falha de autenticação na API do GLPI. Nenhum ticket foi criado. Acione revisão operacional.',
      details: expect.objectContaining({
        glpi_stage: 'glpi_init_session',
        glpi_status_code: 401,
        error_type: 'auth',
      }),
    } satisfies Partial<EntitySelectionError>);

    expect(conversationRepository.failedBeforeTicket[0]).toMatchObject({
      errorMessage: 'glpi_auth_failed before ticket creation at glpi_init_session',
    });
    expect(memoryRepository.remembers).toHaveLength(0);
  });

  it('returns processing quickly and completes ticket creation in background', async () => {
    const { service, conversationRepository, glpiClient } = createService(
      createConversation({ glpiTicketId: 0 }),
      null,
      { processTicketCreationInline: false },
    );

    await expect(service.confirmEntity({
      conversationId: 'conv-1',
      glpiEntityId: 119,
      glpiEntityName: 'Cliente (119)',
      createTicket: true,
    })).resolves.toMatchObject({
      status: 'processing',
      conversationId: 'conv-1',
    });

    await vi.waitFor(() => {
      expect(conversationRepository.linked).toEqual([expect.objectContaining({
        ticketId: 2112319281,
        glpiEntityId: 119,
      })]);
    });
    expect(glpiClient.createTicket).toHaveBeenCalledTimes(1);

    await expect(service.getEntitySelectionStatus('conv-1')).resolves.toMatchObject({
      status: 'succeeded',
      glpiTicketId: 2112319281,
      durationSeconds: 30,
    });
  });

  it('does not start a duplicate GLPI POST while an attempt is processing', async () => {
    const { service, conversationRepository, glpiClient } = createService(
      createConversation({ glpiTicketId: 0 }),
      null,
      { processTicketCreationInline: false },
    );
    conversationRepository.attempts.set('conv-1', {
      id: 'attempt-1',
      conversationId: 'conv-1',
      idempotencyKey: 'entity_selection:conv-1:119',
      status: 'processing',
      glpiEntityId: 119,
      glpiEntityName: 'Cliente (119)',
      glpiTicketId: null,
      errorMessage: null,
      createdAt: new Date('2026-05-12T00:00:00.000Z'),
      updatedAt: new Date('2026-05-12T00:00:00.000Z'),
      finishedAt: null,
    });

    await expect(service.confirmEntity({
      conversationId: 'conv-1',
      glpiEntityId: 119,
      createTicket: true,
    })).resolves.toMatchObject({
      status: 'processing',
      idempotent: true,
    });

    expect(glpiClient.createTicket).not.toHaveBeenCalled();
  });

  it('does not calculate a fake duration for legacy attempts without finished_at', async () => {
    const { service, conversationRepository } = createService(
      createConversation({ glpiTicketId: 0 }),
      null,
      { processTicketCreationInline: false },
    );
    conversationRepository.attempts.set('conv-1', {
      id: 'attempt-1',
      conversationId: 'conv-1',
      idempotencyKey: 'entity_selection:conv-1:119',
      status: 'succeeded',
      glpiEntityId: 119,
      glpiEntityName: 'Cliente (119)',
      glpiTicketId: 2112319281,
      errorMessage: null,
      createdAt: new Date('2026-05-12T00:00:00.000Z'),
      updatedAt: new Date('2026-05-12T01:00:00.000Z'),
      finishedAt: null,
    });

    await expect(service.getEntitySelectionStatus('conv-1')).resolves.toMatchObject({
      status: 'succeeded',
      glpiTicketId: 2112319281,
      finishedAt: null,
      durationSeconds: null,
    });
  });
});
