export interface ContactEntityMemory {
  id: string;
  phoneE164: string;
  contactId: string | null;
  glpiEntityId: number;
  glpiEntityName: string | null;
  sourceTicketId: number | null;
  sourceConversationId: string | null;
  source: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface RememberContactEntityInput {
  phoneE164: string;
  contactId?: string | null;
  glpiEntityId: number;
  glpiEntityName?: string | null;
  sourceTicketId?: number | null;
  sourceConversationId?: string | null;
  source?: string;
}

export interface ContactEntityMemoryRepository {
  findActiveByPhone(phoneE164: string): Promise<ContactEntityMemory | null>;
  rememberEntityForPhone(input: RememberContactEntityInput): Promise<ContactEntityMemory>;
}
