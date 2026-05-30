import { describe, expect, it, vi } from 'vitest';

import type { Contact } from '../src/domain/entities/Contact.js';
import type { ContactRepository, UpsertContactInput } from '../src/repositories/contracts/ContactRepository.js';
import { ContactResolutionService } from '../src/domain/services/ContactResolutionService.js';
import { normalizePhone } from '../src/domain/utils/normalizePhone.js';

class FakeContactCacheRepository {
  public cachedContact: {
    phoneE164: string;
    localContactId: string;
    glpiContactId: number | null;
    glpiUserId: number | null;
    name: string | null;
    source: string;
  } | null = null;

  public buildCacheKey(phoneE164: string): string {
    return `glpi_plugin_whatsapp:contact:phone:${phoneE164}`;
  }

  public async getByPhone(): Promise<typeof this.cachedContact> {
    return this.cachedContact;
  }

  public async setByPhone(contact: NonNullable<typeof this.cachedContact>): Promise<void> {
    this.cachedContact = contact;
  }
}

class FakeContactRepository implements ContactRepository {
  public async upsert(input: UpsertContactInput): Promise<Contact> {
    return {
      id: 'contact-1',
      phoneE164: input.phoneE164,
      glpiContactId: input.glpiContactId,
      glpiUserId: input.glpiUserId,
      name: input.name,
      source: input.source,
      cacheKey: input.cacheKey,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }
}

describe('ContactResolutionService', () => {
  it('keeps Brazilian mobile identity stable with or without the ninth digit', () => {
    expect(normalizePhone('+55 (11) 9999-9999')).toBe('+5511999999999');
    expect(normalizePhone('+55 (11) 99999-9999')).toBe('+5511999999999');
    expect(normalizePhone('+55 (11) 3333-4444')).toBe('+551133334444');
  });

  it('preserves international numbers without Brazilian ninth digit changes', () => {
    expect(normalizePhone('+1 (415) 555-0100')).toBe('+14155550100');
    expect(normalizePhone('+44 20 7946 0958')).toBe('+442079460958');
  });

  it('uses Redis cache before querying GLPI', async () => {
    const cacheRepository = new FakeContactCacheRepository();
    cacheRepository.cachedContact = {
      phoneE164: '+5511999999999',
      localContactId: 'contact-1',
      glpiContactId: 10,
      glpiUserId: 20,
      name: 'Cached User',
      source: 'redis_cache',
    };

    const glpiClient = {
      findContactByPhone: vi.fn(),
    };

    const service = new ContactResolutionService(
      cacheRepository as never,
      new FakeContactRepository(),
      glpiClient as never,
    );

    const contact = await service.resolve('+55 (11) 99999-9999', 'Meta User');

    expect(contact.glpiUserId).toBe(20);
    expect(glpiClient.findContactByPhone).not.toHaveBeenCalled();
  });

  it('queries GLPI and caches the result on cache miss', async () => {
    const cacheRepository = new FakeContactCacheRepository();
    const glpiClient = {
      findContactByPhone: vi.fn().mockResolvedValue({
        glpiContactId: 30,
        glpiUserId: 40,
        name: 'GLPI User',
      }),
    };

    const service = new ContactResolutionService(
      cacheRepository as never,
      new FakeContactRepository(),
      glpiClient as never,
    );

    const contact = await service.resolve('5511999999999', null);

    expect(contact.glpiUserId).toBe(40);
    expect(glpiClient.findContactByPhone).toHaveBeenCalledWith('+5511999999999');
    expect(cacheRepository.cachedContact?.glpiUserId).toBe(40);
  });

  it('falls back to a local logical contact when GLPI lookup throws', async () => {
    const cacheRepository = new FakeContactCacheRepository();
    const glpiClient = {
      findContactByPhone: vi.fn().mockRejectedValue(new Error('fetch failed')),
    };

    const service = new ContactResolutionService(
      cacheRepository as never,
      new FakeContactRepository(),
      glpiClient as never,
    );

    const contact = await service.resolve('5511999999999', 'Maria');

    expect(contact.source).toBe('glpi_contact_lookup_fallback');
    expect(contact.glpiContactId).toBeNull();
    expect(contact.glpiUserId).toBeNull();
    expect(contact.name).toBe('Maria');
    expect(cacheRepository.cachedContact?.source).toBe('glpi_contact_lookup_fallback');
  });

  it('uses normalized phone as name when GLPI lookup throws without Meta contact name', async () => {
    const cacheRepository = new FakeContactCacheRepository();
    const glpiClient = {
      findContactByPhone: vi.fn().mockRejectedValue(new Error('fetch failed')),
    };

    const service = new ContactResolutionService(
      cacheRepository as never,
      new FakeContactRepository(),
      glpiClient as never,
    );

    const contact = await service.resolve('5511999999999', null);

    expect(contact.source).toBe('glpi_contact_lookup_fallback');
    expect(contact.name).toBe('+5511999999999');
  });
});
