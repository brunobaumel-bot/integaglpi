import { describe, expect, it } from 'vitest';

import { ContactProfileService } from '../src/domain/services/ContactProfileService.js';
import type {
  ContactProfilePersistenceRepository,
  ContactProfileRecord,
  ConversationProfileSnapshotRecord,
} from '../src/domain/repositories/ContactProfilePersistenceRepository.js';
import type { SettingsRepository } from '../src/domain/repositories/SettingsRepository.js';

class FakeSettingsRepository implements SettingsRepository {
  public constructor(private readonly values = new Map<string, unknown>()) {}

  public async findMessageSettings(): Promise<Map<string, string>> {
    return new Map();
  }

  public async findBusinessHoursSettings(): Promise<Map<string, unknown>> {
    return new Map();
  }

  public async findContactProfileSettings(): Promise<Map<string, unknown>> {
    return this.values;
  }

  public async findEntityResolutionSettings(): Promise<Map<string, unknown>> {
    return new Map();
  }
}

class FakeProfileRepository implements ContactProfilePersistenceRepository {
  public profiles = new Map<string, Record<string, unknown>>();
  public snapshots = new Map<string, Record<string, unknown>>();
  public snapshotPhones = new Map<string, string>();

  public async findByPhoneE164(phoneE164: string): Promise<ContactProfileRecord | null> {
    const profile = this.profiles.get(phoneE164);
    return profile
      ? { phoneE164, profile, updatedAt: new Date('2026-05-12T00:00:00.000Z') }
      : null;
  }

  public async upsertProfile(phoneE164: string, profile: Record<string, unknown>): Promise<void> {
    this.profiles.set(phoneE164, profile);
  }

  public async findSnapshotByConversationId(conversationId: string): Promise<ConversationProfileSnapshotRecord | null> {
    const snapshotJson = this.snapshots.get(conversationId);
    const phoneE164 = this.snapshotPhones.get(conversationId);
    return snapshotJson
      ? { conversationId, phoneE164: phoneE164 ?? '', snapshotJson, updatedAt: new Date('2026-05-12T00:00:00.000Z') }
      : null;
  }

  public async upsertSnapshot(
    conversationId: string,
    phoneE164: string,
    snapshotJson: Record<string, unknown>,
  ): Promise<void> {
    this.snapshotPhones.set(conversationId, phoneE164);
    this.snapshots.set(conversationId, snapshotJson);
  }
}

describe('ContactProfileService', () => {
  it('parses profile text, treats unknown equipment safely, and creates a snapshot', async () => {
    const repository = new FakeProfileRepository();
    const service = new ContactProfileService(new FakeSettingsRepository(), repository);

    const profile = await service.saveProfileFromText(
      'contact-1',
      '+5511999999999',
      'Empresa: ACME; Nome: Joao Silva; Etiqueta: nao sei; Problema: notebook nao liga',
      'conversation-1',
    );
    const snapshot = await service.createSnapshot('conversation-1', 'contact-1', '+5511999999999', profile);

    expect(profile).toMatchObject({
      company_name_raw: 'ACME',
      requester_name: 'Joao Silva',
      last_equipment_tag: null,
      equipment_tag_unknown: true,
      last_problem_summary: 'notebook nao liga',
      profile_status: 'complete',
      last_conversation_id: 'conversation-1',
    });
    expect(snapshot).toMatchObject(profile);
    expect(repository.snapshots.get('conversation-1')).toMatchObject({
      phone_e164: '+5511999999999',
      source_contact_id: 'contact-1',
      company_name_raw: 'ACME',
    });
    expect(repository.snapshotPhones.get('conversation-1')).toBe('+5511999999999');
  });

  it('enriches ticket title and body only when title enrichment is enabled', async () => {
    const service = new ContactProfileService(
      new FakeSettingsRepository(new Map([['ticket_title_enrichment_enabled', '1']])),
      new FakeProfileRepository(),
    );
    const payload = await service.enrichTicketPayload({
      baseTitle: 'WhatsApp inbound +5511999999999',
      baseContent: 'Mensagem original',
      phoneE164: '+5511999999999',
      queueLabel: 'Suporte',
      profile: {
        phone_e164: '+5511999999999',
        requester_name: 'Joao Silva',
        company_name_raw: 'ACME',
        last_equipment_tag: 'ETQ-123',
        equipment_tag_unknown: false,
        last_problem_summary: 'notebook nao liga',
        profile_status: 'complete',
        profile_source: 'whatsapp',
        confirmation_count: 1,
        last_confirmed_at: '2026-05-12T00:00:00.000Z',
      },
    });

    expect(payload.title).toBe('[WA][Suporte] ACME — Joao Silva — notebook nao liga');
    expect(payload.content).toContain('Nome informado: Joao Silva');
    expect(payload.content).toContain('Etiqueta/Patrimonio: ETQ-123');
    expect(payload.content).toContain('Motivo informado: notebook nao liga');
    expect(payload.content).toContain('Mensagens iniciais:\nMensagem original');
  });

  it('normalizes collection and snapshot boolean values from plugin/Postgres scalars', async () => {
    const repository = new FakeProfileRepository();
    repository.profiles.set('+5511999999999', {
      phone_e164: '+5511999999999',
      requester_name: 'Joao Silva',
      company_name_raw: 'ACME',
      last_equipment_tag: null,
      equipment_tag_unknown: '1',
      last_problem_summary: 'notebook nao liga',
      profile_status: 'complete',
      confirmation_count: 1,
      last_confirmed_at: '2026-05-12T00:00:00.000Z',
    });
    const service = new ContactProfileService(
      new FakeSettingsRepository(new Map([['contact_profile_collection_enabled', 'on']])),
      repository,
    );

    await expect(service.isCollectionEnabled()).resolves.toBe(true);
    await expect(service.findProfile('+5511999999999')).resolves.toMatchObject({
      equipment_tag_unknown: true,
    });
  });

  it('uses the synced profile_initial_prompt when available', async () => {
    const service = new ContactProfileService(
      new FakeSettingsRepository(new Map([['profile_initial_prompt', 'Prompt inicial sincronizado']])),
      new FakeProfileRepository(),
    );

    await expect(service.getInitialPrompt()).resolves.toBe('Prompt inicial sincronizado');
  });

  it('accepts one-message profile answers split by lines', async () => {
    const service = new ContactProfileService(new FakeSettingsRepository(), new FakeProfileRepository());

    const profile = await service.saveProfileFromText(
      'contact-1',
      '+5511999999999',
      ['Empresa X', 'Bruno Baumel', 'nao sei', 'computador sem acesso'].join('\n'),
      'conversation-1',
    );

    expect(profile).toMatchObject({
      company_name_raw: 'Empresa X',
      requester_name: 'Bruno Baumel',
      last_equipment_tag: null,
      equipment_tag_unknown: true,
      last_problem_summary: 'computador sem acesso',
      profile_status: 'complete',
    });
  });

  it('marks required missing fields as incomplete and builds a missing-fields prompt', async () => {
    const service = new ContactProfileService(
      new FakeSettingsRepository(new Map([
        ['contact_profile_require_name', '1'],
        ['contact_profile_require_company', '1'],
        ['contact_profile_require_equipment', '1'],
        ['contact_profile_require_summary', '1'],
      ])),
      new FakeProfileRepository(),
    );

    const profile = await service.saveProfileFromText(
      'contact-1',
      '+5511999999999',
      'Empresa X',
      'conversation-1',
    );

    expect(profile.profile_status).toBe('incomplete');
    await expect(service.isProfileComplete(profile)).resolves.toBe(false);
    await expect(service.buildMissingFieldsPrompt(profile)).resolves.toContain('nome');
    await expect(service.buildMissingFieldsPrompt(profile)).resolves.toContain('etiqueta/patrimonio');
    await expect(service.buildMissingFieldsPrompt(profile)).resolves.toContain('resumo do problema');
  });

  it('collects fixed profile fields step by step and accepts a 4 digit equipment tag', async () => {
    const service = new ContactProfileService(new FakeSettingsRepository(), new FakeProfileRepository());
    const company = service.processCollectionResponse({
      phoneE164: '+5511999999999',
      state: service.startNewCollectionState('Suporte'),
      text: 'Etica Informatica',
    });
    const name = service.processCollectionResponse({
      phoneE164: '+5511999999999',
      state: company.state,
      text: 'Bruno Baumel',
    });
    const email = service.processCollectionResponse({
      phoneE164: '+5511999999999',
      state: name.state,
      text: 'BRUNO@EXAMPLE.COM',
    });
    const tag = service.processCollectionResponse({
      phoneE164: '+5511999999999',
      state: email.state,
      text: '2022',
    });
    const reason = service.processCollectionResponse({
      phoneE164: '+5511999999999',
      state: tag.state,
      text: 'Estou com problemas no Outlook.',
    });

    expect(company.state.step).toBe('asking_name');
    expect(name.state.step).toBe('asking_email');
    expect(email.state).toMatchObject({ step: 'asking_tag', email_address: 'bruno@example.com', email_status: 'valid' });
    expect(tag.state.step).toBe('asking_reason');
    expect(reason.completed).toBe(true);
    expect(reason.profile).toMatchObject({
      company_name_raw: 'Etica Informatica',
      requester_name: 'Bruno Baumel',
      email_address: 'bruno@example.com',
      last_equipment_tag: '2022',
      equipment_tag_unknown: false,
      last_problem_summary: 'Estou com problemas no Outlook.',
    });

    const leadingZeroTag = service.processCollectionResponse({
      phoneE164: '+5511999999999',
      state: email.state,
      text: '0640',
    });
    expect(leadingZeroTag.state).toMatchObject({
      step: 'asking_reason',
      last_equipment_tag: '0640',
      equipment_tag_unknown: false,
    });
  });

  it('repeats the equipment question for invalid tags and accepts unknown equipment', async () => {
    const service = new ContactProfileService(new FakeSettingsRepository(), new FakeProfileRepository());
    const state = {
      step: 'asking_tag' as const,
      company_name_raw: 'Etica',
      requester_name: 'Bruno',
    };

    const invalidShort = service.processCollectionResponse({
      phoneE164: '+5511999999999',
      state,
      text: '123',
    });
    const invalidLong = service.processCollectionResponse({
      phoneE164: '+5511999999999',
      state,
      text: '12345',
    });
    const unknown = service.processCollectionResponse({
      phoneE164: '+5511999999999',
      state,
      text: 'TAG_UNKNOWN',
    });
    const invalidLetters = service.processCollectionResponse({
      phoneE164: '+5511999999999',
      state,
      text: 'abcd',
    });

    expect(invalidShort.state.step).toBe('asking_tag');
    expect(invalidShort.reply).toContain('Etiqueta inválida');
    expect(invalidShort.reply).toContain('4 números');
    expect(invalidLong.state.step).toBe('asking_tag');
    expect(invalidLong.reply).toContain('Etiqueta inválida');
    expect(invalidLetters.state.step).toBe('asking_tag');
    expect(invalidLetters.reply).toContain('Etiqueta inválida');
    expect(unknown.state).toMatchObject({
      step: 'asking_reason',
      last_equipment_tag: null,
      equipment_tag_unknown: true,
    });
  });

  it('confirms existing profile with yes/no before asking the new attendance reason', async () => {
    const service = new ContactProfileService(new FakeSettingsRepository(), new FakeProfileRepository());
    const profile = service.parseProfileText(
      '+5511999999999',
      'Empresa: Etica; Nome: Bruno; Etiqueta: 2022; Problema: ultimo atendimento',
    );
    const state = service.startExistingProfileConfirmationState(profile, 'Suporte');

    const yes = service.processCollectionResponse({
      phoneE164: '+5511999999999',
      state,
      text: 'Sim',
      existingProfile: profile,
    });
    const no = service.processCollectionResponse({
      phoneE164: '+5511999999999',
      state,
      text: 'Nao',
      existingProfile: profile,
    });

    expect(yes.state).toMatchObject({
      step: 'asking_reason',
      company_name_raw: 'Etica',
      requester_name: 'Bruno',
      last_equipment_tag: '2022',
    });
    expect(yes.reply).toContain('motivo');
    expect(no.state.step).toBe('asking_company');
  });

  it('only treats complete profiles with valid fixed fields as reliable for confirmation', () => {
    const service = new ContactProfileService(new FakeSettingsRepository(), new FakeProfileRepository());
    const baseProfile = service.parseProfileText(
      '+5511999999999',
      'Empresa: Etica; Nome: Bruno; Etiqueta: 2022; Problema: ultimo atendimento',
    );

    expect(service.isReliableForConfirmation({ ...baseProfile, profile_status: 'complete' })).toBe(true);
    expect(service.isReliableForConfirmation({
      ...baseProfile,
      profile_status: 'complete',
      last_equipment_tag: '12345',
    })).toBe(false);
    expect(service.isReliableForConfirmation({
      ...baseProfile,
      profile_status: 'complete',
      last_equipment_tag: null,
      equipment_tag_unknown: true,
    })).toBe(true);
    expect(service.isReliableForConfirmation({
      ...baseProfile,
      profile_status: 'complete',
      company_name_raw: null,
    })).toBe(false);
    expect(service.isReliableForConfirmation({
      ...baseProfile,
      profile_status: 'complete',
      requester_name: null,
    })).toBe(false);
    expect(service.isReliableForConfirmation({ ...baseProfile, profile_status: 'incomplete' })).toBe(false);
  });
});
