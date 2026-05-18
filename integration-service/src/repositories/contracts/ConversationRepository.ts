import type { Conversation } from '../../domain/entities/Conversation.js';

export interface CreateConversationInput {
  phoneE164: string;
  contactId: string;
  glpiTicketId: number | null;
  status: string;
  lastMessageAt: Date;
}

export type EntitySelectionAttemptStatus =
  | 'processing'
  | 'succeeded'
  | 'failed_before_ticket'
  | 'failed_after_ticket'
  | 'cancelled';

export interface EntitySelectionAttempt {
  id: string;
  conversationId: string;
  idempotencyKey: string | null;
  status: EntitySelectionAttemptStatus;
  glpiEntityId: number | null;
  glpiEntityName: string | null;
  glpiTicketId: number | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  finishedAt: Date | null;
}

export interface EntitySelectionAttemptReserveResult {
  wasCreated: boolean;
  attempt: EntitySelectionAttempt;
}

export interface ConversationRepository {
  findReusableByPhoneE164(phoneE164: string): Promise<Conversation | null>;
  findPendingGlpiOrphanByPhoneE164(phoneE164: string): Promise<Conversation | null>;
  findLatestClosedByPhoneE164(phoneE164: string): Promise<Conversation | null>;
  findById(conversationId: string): Promise<Conversation | null>;
  findByIdAndGlpiTicketId(conversationId: string, glpiTicketId: number): Promise<Conversation | null>;
  create(input: CreateConversationInput): Promise<Conversation>;
  linkGlpiTicket(
    conversationId: string,
    ticketId: number,
    queueId?: number | null,
    glpiEntityId?: number | null,
    glpiEntityName?: string | null,
  ): Promise<boolean>;
  updateStatus(conversationId: string, status: string): Promise<void>;
  updateQueueAndStatus(conversationId: string, queueId: number | null, status: string): Promise<void>;
  updateProfileCollectionState(conversationId: string, state: Record<string, unknown>): Promise<void>;
  reopenConversation(conversationId: string): Promise<void>;
  touch(conversationId: string, occurredAt: Date): Promise<void>;
  reserveEntitySelectionAttempt(
    conversationId: string,
    glpiEntityId: number,
    glpiEntityName?: string | null,
    idempotencyKey?: string | null,
  ): Promise<EntitySelectionAttemptReserveResult>;
  findEntitySelectionAttemptByConversationId(conversationId: string): Promise<EntitySelectionAttempt | null>;
  markEntitySelectionAttemptSucceeded(attemptId: string, glpiTicketId: number): Promise<void>;
  markEntitySelectionAttemptFailedBeforeTicket(attemptId: string, errorMessage: string): Promise<void>;
  markEntitySelectionAttemptFailedAfterTicket(
    attemptId: string,
    glpiTicketId: number,
    errorMessage: string,
  ): Promise<void>;
}
