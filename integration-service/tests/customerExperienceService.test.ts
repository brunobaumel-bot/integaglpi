import { describe, expect, it, vi } from 'vitest';

import { CustomerExperienceService } from '../src/domain/services/CustomerExperienceService.js';
import type { ContactProfileData, ContactProfileService } from '../src/domain/services/ContactProfileService.js';

function makeProfile(overrides: Partial<ContactProfileData> = {}): ContactProfileData {
  return {
    phone_e164: '+5541999999999',
    company_name_raw: 'Etica',
    requester_name: 'Maria Silva',
    email_address: ' MARIA@EXAMPLE.COM ',
    email_status: 'valid',
    last_equipment_tag: '2022',
    equipment_tag_unknown: false,
    last_problem_summary: 'Computador lento',
    profile_status: 'complete',
    profile_source: 'whatsapp',
    confirmation_count: 1,
    last_confirmed_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeContactProfileService() {
  return {
    normalizeEmail: (value: string | null | undefined): string | null => {
      const normalized = String(value ?? '').trim().toLowerCase();
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : null;
    },
    saveProfileData: vi.fn(async (_phoneE164: string, profile: ContactProfileData) => profile),
  } satisfies Pick<ContactProfileService, 'normalizeEmail' | 'saveProfileData'>;
}

describe('CustomerExperienceService', () => {
  it('links exactly one active GLPI user found by normalized email', async () => {
    const glpiClient = {
      findUsersByEmail: vi.fn().mockResolvedValue([
        { id: 44, name: 'Maria Silva', email: 'maria@example.com', isActive: true },
      ]),
      createRestrictedRequesterUser: vi.fn(),
    };
    const contactProfileService = makeContactProfileService();
    const service = new CustomerExperienceService(glpiClient, contactProfileService);

    const result = await service.resolveGlpiRequester({
      phoneE164: '+5541999999999',
      profile: makeProfile(),
      entitiesId: 54,
      conversationId: 'conv-1',
    });

    expect(result).toEqual({ status: 'linked_existing', glpiUserId: 44, created: false });
    expect(glpiClient.findUsersByEmail).toHaveBeenCalledWith('maria@example.com');
    expect(glpiClient.createRestrictedRequesterUser).not.toHaveBeenCalled();
    expect(contactProfileService.saveProfileData).toHaveBeenCalledWith(
      '+5541999999999',
      expect.objectContaining({
        email_address: 'maria@example.com',
        glpi_user_id: 44,
        glpi_user_link_status: 'linked_existing',
        glpi_user_link_source: 'email_unique_active',
        glpi_user_created_by_integaglpi: false,
      }),
      'conv-1',
    );
  });

  it('does not auto-link when GLPI returns multiple users for the email', async () => {
    const glpiClient = {
      findUsersByEmail: vi.fn().mockResolvedValue([
        { id: 44, name: 'Maria Silva', email: 'maria@example.com', isActive: true },
        { id: 45, name: 'Maria B', email: 'maria@example.com', isActive: true },
      ]),
      createRestrictedRequesterUser: vi.fn(),
    };
    const contactProfileService = makeContactProfileService();
    const service = new CustomerExperienceService(glpiClient, contactProfileService);

    const result = await service.resolveGlpiRequester({
      phoneE164: '+5541999999999',
      profile: makeProfile(),
      entitiesId: 54,
      conversationId: 'conv-1',
    });

    expect(result).toEqual({ status: 'ambiguous', glpiUserId: null, created: false });
    expect(glpiClient.createRestrictedRequesterUser).not.toHaveBeenCalled();
    expect(contactProfileService.saveProfileData).toHaveBeenCalledWith(
      '+5541999999999',
      expect.objectContaining({
        glpi_user_id: null,
        glpi_user_link_status: 'ambiguous',
        glpi_user_link_source: 'manual_required',
      }),
      'conv-1',
    );
  });

  it('does not auto-link an inactive GLPI user', async () => {
    const glpiClient = {
      findUsersByEmail: vi.fn().mockResolvedValue([
        { id: 44, name: 'Maria Silva', email: 'maria@example.com', isActive: false },
      ]),
      createRestrictedRequesterUser: vi.fn(),
    };
    const contactProfileService = makeContactProfileService();
    const service = new CustomerExperienceService(glpiClient, contactProfileService);

    const result = await service.resolveGlpiRequester({
      phoneE164: '+5541999999999',
      profile: makeProfile(),
      entitiesId: 54,
      conversationId: 'conv-1',
    });

    expect(result).toEqual({ status: 'inactive', glpiUserId: null, created: false });
    expect(glpiClient.createRestrictedRequesterUser).not.toHaveBeenCalled();
  });

  it('does not create a GLPI requester when no active user is found by email', async () => {
    const glpiClient = {
      findUsersByEmail: vi.fn().mockResolvedValue([]),
      createRestrictedRequesterUser: vi.fn().mockResolvedValue(77),
    };
    const contactProfileService = makeContactProfileService();
    const service = new CustomerExperienceService(glpiClient, contactProfileService);

    const result = await service.resolveGlpiRequester({
      phoneE164: '+5541999999999',
      profile: makeProfile(),
      entitiesId: 54,
      conversationId: 'conv-1',
    });

    expect(result).toEqual({ status: 'not_found', glpiUserId: null, created: false });
    expect(glpiClient.createRestrictedRequesterUser).not.toHaveBeenCalled();
    expect(contactProfileService.saveProfileData).toHaveBeenCalledWith(
      '+5541999999999',
      expect.objectContaining({
        glpi_user_id: null,
        glpi_user_link_status: 'not_found',
        glpi_user_link_source: 'manual_required',
        glpi_user_created_by_integaglpi: false,
      }),
      'conv-1',
    );
  });

  it('does not create a GLPI user before a real entity exists', async () => {
    const glpiClient = {
      findUsersByEmail: vi.fn(),
      createRestrictedRequesterUser: vi.fn(),
    };
    const contactProfileService = makeContactProfileService();
    const service = new CustomerExperienceService(glpiClient, contactProfileService);

    const result = await service.resolveGlpiRequester({
      phoneE164: '+5541999999999',
      profile: makeProfile(),
      entitiesId: 0,
      conversationId: 'conv-1',
    });

    expect(result).toEqual({ status: 'entity_required', glpiUserId: null, created: false });
    expect(glpiClient.findUsersByEmail).not.toHaveBeenCalled();
    expect(glpiClient.createRestrictedRequesterUser).not.toHaveBeenCalled();
  });

  it('treats invalid or missing email as non-blocking for the attendance', async () => {
    const glpiClient = {
      findUsersByEmail: vi.fn(),
      createRestrictedRequesterUser: vi.fn(),
    };
    const contactProfileService = makeContactProfileService();
    const service = new CustomerExperienceService(glpiClient, contactProfileService);

    const result = await service.resolveGlpiRequester({
      phoneE164: '+5541999999999',
      profile: makeProfile({ email_address: 'sem-email', email_status: 'invalid' }),
      entitiesId: 54,
      conversationId: 'conv-1',
    });

    expect(result).toEqual({ status: 'email_invalid', glpiUserId: null, created: false });
    expect(glpiClient.findUsersByEmail).not.toHaveBeenCalled();
    expect(glpiClient.createRestrictedRequesterUser).not.toHaveBeenCalled();
  });
});
