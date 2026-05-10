import type { Contact } from '../../domain/entities/Contact.js';

export interface UpsertContactInput {
  phoneE164: string;
  glpiContactId: number | null;
  glpiUserId: number | null;
  name: string | null;
  source: string;
  cacheKey: string;
}

export interface ContactRepository {
  upsert(input: UpsertContactInput): Promise<Contact>;
}

