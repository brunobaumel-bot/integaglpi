import type { GlpiContactLookupResult } from '../../adapters/glpi/glpiTypes.js';
import type { GlpiClient } from '../../adapters/glpi/GlpiClient.js';
import type { ContactRepository } from '../../repositories/contracts/ContactRepository.js';
import type { Contact } from '../entities/Contact.js';

import { ContactCacheRepository } from '../../cache/ContactCacheRepository.js';
import { logger } from '../../infra/logger/logger.js';
import { normalizePhone } from '../utils/normalizePhone.js';

export class ContactResolutionService {
  public constructor(
    private readonly contactCacheRepository: ContactCacheRepository,
    private readonly contactRepository: ContactRepository,
    private readonly glpiClient: GlpiClient,
  ) {}

  public async resolve(phone: string, contactName: string | null): Promise<Contact> {
    const phoneE164 = normalizePhone(phone);
    const cachedIdentity = await this.contactCacheRepository.getByPhone(phoneE164);

    if (cachedIdentity) {
      logger.info({ phoneE164 }, 'Contact cache hit.');

      return this.contactRepository.upsert({
        phoneE164,
        glpiContactId: cachedIdentity.glpiContactId,
        glpiUserId: cachedIdentity.glpiUserId,
        name: cachedIdentity.name ?? contactName,
        source: 'redis_cache',
        cacheKey: this.contactCacheRepository.buildCacheKey(phoneE164),
      });
    }

    logger.info({ phoneE164 }, 'Contact cache miss.');

    let glpiContact: GlpiContactLookupResult | null = null;
    let glpiContactLookupThrew = false;

    try {
      glpiContact = await this.glpiClient.findContactByPhone(phoneE164);
    } catch (error: unknown) {
      glpiContactLookupThrew = true;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.warn(
        {
          stage: 'glpi_contact_lookup',
          fallback_contact_lookup: true,
          errorMessage,
          phoneE164,
        },
        'GLPI contact lookup failed; PoC fallback will use local logical contact without GLPI ids.',
      );
    }

    const logicalName = glpiContactLookupThrew
      ? contactName ?? phoneE164
      : glpiContact?.name ?? contactName;

    const contact = await this.contactRepository.upsert({
      phoneE164,
      glpiContactId: glpiContact?.glpiContactId ?? null,
      glpiUserId: glpiContact?.glpiUserId ?? null,
      name: logicalName,
      source: glpiContactLookupThrew
        ? 'glpi_contact_lookup_fallback'
        : glpiContact
          ? 'glpi_api'
          : 'meta_webhook',
      cacheKey: this.contactCacheRepository.buildCacheKey(phoneE164),
    });

    await this.contactCacheRepository.setByPhone({
      phoneE164,
      localContactId: contact.id,
      glpiContactId: contact.glpiContactId,
      glpiUserId: contact.glpiUserId,
      name: contact.name,
      source: contact.source,
    });

    return contact;
  }
}

