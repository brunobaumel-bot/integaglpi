export interface ContactProfileRecord {
  phoneE164: string;
  profile: Record<string, unknown>;
  updatedAt: Date;
}

export interface ConversationProfileSnapshotRecord {
  conversationId: string;
  phoneE164: string;
  snapshotJson: Record<string, unknown>;
  updatedAt: Date;
}

export interface ContactProfilePersistenceRepository {
  findByPhoneE164(phoneE164: string): Promise<ContactProfileRecord | null>;
  upsertProfile(phoneE164: string, profile: Record<string, unknown>): Promise<void>;
  findSnapshotByConversationId(conversationId: string): Promise<ConversationProfileSnapshotRecord | null>;
  upsertSnapshot(conversationId: string, phoneE164: string, snapshotJson: Record<string, unknown>): Promise<void>;
}
