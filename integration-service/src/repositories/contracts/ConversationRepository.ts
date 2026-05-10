import type { Conversation } from '../../domain/entities/Conversation.js';

export interface CreateConversationInput {
  phoneE164: string;
  contactId: string;
  glpiTicketId: number | null;
  status: string;
  lastMessageAt: Date;
}

export interface ConversationRepository {
  findReusableByPhoneE164(phoneE164: string): Promise<Conversation | null>;
  findPendingGlpiOrphanByPhoneE164(phoneE164: string): Promise<Conversation | null>;
  findLatestClosedByPhoneE164(phoneE164: string): Promise<Conversation | null>;
  findById(conversationId: string): Promise<Conversation | null>;
  findByIdAndGlpiTicketId(conversationId: string, glpiTicketId: number): Promise<Conversation | null>;
  create(input: CreateConversationInput): Promise<Conversation>;
  linkGlpiTicket(conversationId: string, ticketId: number, queueId?: number | null): Promise<boolean>;
  updateStatus(conversationId: string, status: string): Promise<void>;
  reopenConversation(conversationId: string): Promise<void>;
  touch(conversationId: string, occurredAt: Date): Promise<void>;
}
