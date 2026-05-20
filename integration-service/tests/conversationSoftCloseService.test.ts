import { describe, expect, it, vi } from 'vitest';

import type { KeyLock } from '../src/domain/contracts/KeyLock.js';
import type { Conversation } from '../src/domain/entities/Conversation.js';
import {
  ConversationSoftCloseError,
  ConversationSoftCloseService,
} from '../src/domain/services/ConversationSoftCloseService.js';
import type { ConversationRepository } from '../src/repositories/contracts/ConversationRepository.js';

const now = new Date('2026-05-18T12:00:00.000Z');

function createConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conv-1',
    phoneE164: '+5511999999999',
    contactId: 'contact-1',
    glpiTicketId: null,
    queueId: null,
    status: 'awaiting_queue_selection',
    lastMessageAt: new Date('2026-05-18T10:00:00.000Z'),
    createdAt: new Date('2026-05-18T09:00:00.000Z'),
    updatedAt: new Date('2026-05-18T10:00:00.000Z'),
    ...overrides,
  };
}

function createRepository(conversation: Conversation | null) {
  const softCloseAdministrative = vi.fn().mockResolvedValue(true);
  const repository = {
    findById: vi.fn().mockResolvedValue(conversation),
    softCloseAdministrative,
  } as unknown as ConversationRepository;

  return { repository, softCloseAdministrative };
}

function createLock(overrides: Partial<KeyLock> = {}): KeyLock {
  return {
    withLock: vi.fn(async (_key: string, work: () => Promise<unknown>) => work()),
    ...overrides,
  };
}

function createService(
  conversation: Conversation | null,
  options: {
    lock?: KeyLock;
    audit?: { recordAuditEvent: ReturnType<typeof vi.fn> };
  } = {},
) {
  const { repository, softCloseAdministrative } = createRepository(conversation);
  const lock = options.lock ?? createLock();
  const audit = options.audit ?? { recordAuditEvent: vi.fn().mockResolvedValue(undefined) };
  const service = new ConversationSoftCloseService(
    repository,
    lock,
    audit as never,
    { now: () => now, minimumInactiveMs: 30 * 60 * 1000 },
  );

  return { service, repository, lock, audit, softCloseAdministrative };
}

describe('ConversationSoftCloseService', () => {
  it('soft-closes an eligible pre-ticket conversation and records audit', async () => {
    const { service, lock, audit, softCloseAdministrative } = createService(createConversation());

    const result = await service.softClose({
      conversationId: 'conv-1',
      reason: 'Abandono confirmado pelo operador',
      operatorId: 7,
      operatorName: 'Operador Teste',
      ip: '127.0.0.1',
    });

    expect(result).toMatchObject({
      status: 'cancelled',
      previousStatus: 'awaiting_queue_selection',
      newStatus: 'cancelled',
      idempotent: false,
    });
    expect(lock.withLock).toHaveBeenCalledWith('conversation_soft_close:conv-1', expect.any(Function));
    expect(softCloseAdministrative).toHaveBeenCalledWith('conv-1', 'awaiting_queue_selection', 'cancelled');
    expect(audit.recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conv-1',
      eventType: 'ADMIN_SOFT_CLOSE',
      payload: expect.objectContaining({
        operator_id: 7,
        previous_status: 'awaiting_queue_selection',
        new_status: 'cancelled',
        reason: 'Abandono confirmado pelo operador',
      }),
    }));
  });

  it('rejects a missing reason before acquiring the lock', async () => {
    const { service, lock } = createService(createConversation());

    await expect(service.softClose({
      conversationId: 'conv-1',
      reason: '  ',
      operatorId: 7,
    })).rejects.toMatchObject({
      errorCode: 'REASON_REQUIRED',
      statusCode: 400,
    });
    expect(lock.withLock).not.toHaveBeenCalled();
  });

  it('blocks conversations that already have a GLPI ticket', async () => {
    const { service } = createService(createConversation({ glpiTicketId: 123 }));

    await expect(service.softClose({
      conversationId: 'conv-1',
      reason: 'Abandonada',
      operatorId: 7,
    })).rejects.toMatchObject({
      errorCode: 'CONVERSATION_HAS_GLPI_TICKET',
      statusCode: 409,
    });
  });

  it('blocks conversations with recent activity', async () => {
    const { service } = createService(createConversation({
      lastMessageAt: new Date('2026-05-18T11:50:00.000Z'),
      updatedAt: new Date('2026-05-18T11:50:00.000Z'),
    }));

    await expect(service.softClose({
      conversationId: 'conv-1',
      reason: 'Abandonada',
      operatorId: 7,
    })).rejects.toMatchObject({
      errorCode: 'CONVERSATION_RECENT_ACTIVITY',
      statusCode: 409,
    });
  });

  it('does not treat a recent internal reminder update as customer activity', async () => {
    const { service, softCloseAdministrative } = createService(createConversation({
      status: 'collecting_contact_profile',
      lastMessageAt: new Date('2026-05-18T10:00:00.000Z'),
      updatedAt: new Date('2026-05-18T11:58:00.000Z'),
    }));

    const result = await service.softClose({
      conversationId: 'conv-1',
      reason: 'Pré-ticket abandonado após lembrete automático',
      operatorId: 7,
    });

    expect(result).toMatchObject({
      status: 'cancelled',
      previousStatus: 'collecting_contact_profile',
      newStatus: 'cancelled',
      idempotent: false,
    });
    expect(softCloseAdministrative).toHaveBeenCalledWith('conv-1', 'collecting_contact_profile', 'cancelled');
  });

  it('blocks terminal statuses without mutating the conversation', async () => {
    const { service, softCloseAdministrative } = createService(createConversation({ status: 'closed' }));

    await expect(service.softClose({
      conversationId: 'conv-1',
      reason: 'Abandonada',
      operatorId: 7,
    })).rejects.toMatchObject({
      errorCode: 'CONVERSATION_ALREADY_TERMINAL',
      statusCode: 409,
    });
    expect(softCloseAdministrative).not.toHaveBeenCalled();
  });

  it('handles repeated soft-close idempotently without a second update', async () => {
    const { service, softCloseAdministrative, audit } = createService(createConversation({ status: 'cancelled' }));

    const result = await service.softClose({
      conversationId: 'conv-1',
      reason: 'Abandonada',
      operatorId: 7,
    });

    expect(result.idempotent).toBe(true);
    expect(softCloseAdministrative).not.toHaveBeenCalled();
    expect(audit.recordAuditEvent).not.toHaveBeenCalled();
  });

  it('returns a controlled conflict when the Redis lock cannot be acquired', async () => {
    const lock = createLock({
      withLock: vi.fn().mockRejectedValue(new Error('RedisKeyLock: failed to acquire lock for conversation_soft_close:conv-1')),
    });
    const { service } = createService(createConversation(), { lock });

    await expect(service.softClose({
      conversationId: 'conv-1',
      reason: 'Abandonada',
      operatorId: 7,
    })).rejects.toBeInstanceOf(ConversationSoftCloseError);
    await expect(service.softClose({
      conversationId: 'conv-1',
      reason: 'Abandonada',
      operatorId: 7,
    })).rejects.toMatchObject({
      errorCode: 'SOFT_CLOSE_LOCK_BUSY',
      statusCode: 409,
    });
  });
});
