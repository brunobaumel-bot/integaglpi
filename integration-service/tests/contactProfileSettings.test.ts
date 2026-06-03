/**
 * contactProfileSettings.test.ts
 *
 * Phase: integaglpi_message_settings_hub_and_smart_reception_fix_001
 *
 * Covers:
 *  1. getInitialPrompt() returns configured value (not hardcoded default)
 *  2. getInitialPrompt() falls back to DEFAULT_INITIAL_PROMPT when configured value is empty
 *  3. getCollectionPrompt() uses configured prompt texts after cache warm-up
 *  4. getCollectionPrompt() falls back to hardcoded strings when configCache is null
 *  5. processCollectionResponse(): awaiting_name -> awaiting_equipment_tag
 *  6. processCollectionResponse(): ignores contact_profile_require_email for Macro 1
 *  7. processCollectionResponse(): cache state does not reinsert e-mail collection
 *  8. Dual-key resolution: canonical key (contact_profile_prompt_*) wins over legacy (profile_ask_*)
 */

import { describe, expect, it } from 'vitest';

import { ContactProfileService } from '../src/domain/services/ContactProfileService.js';
import type {
  ContactProfilePersistenceRepository,
  ContactProfileRecord,
  ConversationProfileSnapshotRecord,
} from '../src/domain/repositories/ContactProfilePersistenceRepository.js';
import type { SettingsRepository } from '../src/domain/repositories/SettingsRepository.js';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

class FakeSettingsRepo implements SettingsRepository {
  public constructor(private readonly cp = new Map<string, unknown>()) {}

  public async findMessageSettings(): Promise<Map<string, string>> { return new Map(); }
  public async findBusinessHoursSettings(): Promise<Map<string, unknown>> { return new Map(); }
  public async findContactProfileSettings(): Promise<Map<string, unknown>> { return this.cp; }
  public async findEntityResolutionSettings(): Promise<Map<string, unknown>> { return new Map(); }
  public async findInactivitySettings(): Promise<Map<string, unknown>> { return new Map(); }
}

class FakeProfileRepo implements ContactProfilePersistenceRepository {
  public async findByPhoneE164(_phone: string): Promise<ContactProfileRecord | null> { return null; }
  public async upsertProfile(_phone: string, _profile: Record<string, unknown>): Promise<void> {}
  public async findSnapshotByConversationId(_id: string): Promise<ConversationProfileSnapshotRecord | null> { return null; }
  public async upsertSnapshot(_id: string, _phone: string, _json: Record<string, unknown>): Promise<void> {}
}

function makeService(cpSettings: Record<string, unknown> = {}): ContactProfileService {
  const settingsMap = new Map<string, unknown>(Object.entries(cpSettings));
  return new ContactProfileService(new FakeSettingsRepo(settingsMap), new FakeProfileRepo());
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('ContactProfileService — settings-driven prompts (phase: message_settings_hub)', () => {

  // ── 1. getInitialPrompt uses configured value ────────────────────────────

  it('getInitialPrompt returns the configured contact_profile_initial_prompt value', async () => {
    const service = makeService({
      contact_profile_initial_prompt: 'Olá! Vamos começar seu atendimento. Informe seu nome.',
    });

    const prompt = await service.getInitialPrompt();

    expect(prompt).toBe('Olá! Vamos começar seu atendimento. Informe seu nome.');
  });

  // ── 2. getInitialPrompt falls back to hardcoded default when empty ────────

  it('getInitialPrompt falls back to default when contact_profile_initial_prompt is empty', async () => {
    const service = makeService({
      contact_profile_initial_prompt: '   ',
    });

    const prompt = await service.getInitialPrompt();

    expect(prompt).toContain('Perfeito! Vou agilizar seu atendimento.');
    expect(prompt).toContain('Envie em uma unica mensagem:');
  });

  it('getInitialPrompt falls back to profile_initial_prompt legacy key when canonical key absent', async () => {
    const service = makeService({
      profile_initial_prompt: 'Prompt legado ainda ativo.',
    });

    const prompt = await service.getInitialPrompt();

    expect(prompt).toBe('Prompt legado ainda ativo.');
  });

  // ── 3. getCollectionPrompt uses configured texts after cache warm-up ──────

  it('getCollectionPrompt uses configured texts after getInitialPrompt warms cache', async () => {
    const service = makeService({
      contact_profile_prompt_company: 'Informe o nome da sua empresa:',
      contact_profile_prompt_name: 'Qual é o seu nome completo?',
      contact_profile_prompt_email: 'Informe seu e-mail corporativo.',
      contact_profile_prompt_equipment: 'Número do patrimônio (4 dígitos):',
      contact_profile_prompt_summary: 'Descreva o problema brevemente:',
      contact_profile_confirm_message: 'Confirme os dados acima.',
    });

    // Warm up configCache
    await service.getInitialPrompt();

    expect(service.getCollectionPrompt({ step: 'awaiting_company' }))
      .toBe('Informe o nome da sua empresa:');
    expect(service.getCollectionPrompt({ step: 'awaiting_name' }))
      .toBe('Qual é o seu nome completo?');
    expect(service.getCollectionPrompt({ step: 'awaiting_equipment_tag' }))
      .toBe('Número do patrimônio (4 dígitos):');
    expect(service.getCollectionPrompt({ step: 'awaiting_problem_summary' }))
      .toBe('Descreva o problema brevemente:');
    expect(service.getCollectionPrompt({ step: 'complete' }))
      .toBe('Confirme os dados acima.');
  });

  // ── 4. getCollectionPrompt falls back to hardcoded when cache is null ─────

  it('getCollectionPrompt uses hardcoded fallbacks when configCache not warmed', () => {
    const service = makeService({});

    // Note: configCache is null here (getInitialPrompt not called)
    expect(service.getCollectionPrompt({ step: 'awaiting_company' }))
      .toContain('empresa');
    expect(service.getCollectionPrompt({ step: 'awaiting_name' }))
      .toContain('nome');
    expect(service.getCollectionPrompt({ step: 'awaiting_equipment_tag' }))
      .toContain('etiqueta');
    expect(service.getCollectionPrompt({ step: 'awaiting_problem_summary' }))
      .toContain('motivo');
  });

  // ── 5. Macro 1: awaiting_name -> awaiting_equipment_tag ─────────────────

  it('processCollectionResponse skips email collection in the Macro 1 fixed flow', async () => {
    const service = makeService({
      contact_profile_require_email: '0',
    });

    // Warm up so configCache has requireEmail=false
    await service.getInitialPrompt();

    const result = service.processCollectionResponse({
      phoneE164: '+5511999999999',
      state: {
        step: 'awaiting_name',
        company_name_raw: 'ACME',
      },
      text: 'Joao Silva',
    });

    expect(result.state.step).toBe('awaiting_equipment_tag');
    expect(result.completed).toBe(false);
    expect(result.state.requester_name).toBe('Joao Silva');
  });

  // ── 6. requireEmail=true no longer changes Macro 1 flow ─────────────────

  it('processCollectionResponse still skips email when requireEmail is true', async () => {
    const service = makeService({
      contact_profile_require_email: '1',
    });

    await service.getInitialPrompt();

    const result = service.processCollectionResponse({
      phoneE164: '+5511999999999',
      state: {
        step: 'awaiting_name',
        company_name_raw: 'ACME',
      },
      text: 'Joao Silva',
    });

    expect(result.state.step).toBe('awaiting_equipment_tag');
    expect(result.completed).toBe(false);
  });

  // ── 7a. REGRESSION: cache warm must not reinsert email ───────────────────

  it('REGRESSION: cache warmed without contact_profile_require_email still advances to equipment tag', async () => {
    // No contact_profile_require_email key in settings at all.
    const service = makeService({});

    // Warm cache — this is what triggered the bug.
    await service.getInitialPrompt();

    const result = service.processCollectionResponse({
      phoneE164: '+5511999999999',
      state: {
        step: 'awaiting_name',
        company_name_raw: 'ACME',
      },
      text: 'Joao Silva',
    });

    expect(result.state.step).toBe('awaiting_equipment_tag');
    expect(result.completed).toBe(false);
  });

  // ── 7b. Default (cache not warmed) still uses the four-step flow ─────────

  it('processCollectionResponse goes to equipment tag by default when cache not warmed', () => {
    const service = makeService({});

    // No getInitialPrompt() call — configCache is null
    const result = service.processCollectionResponse({
      phoneE164: '+5511999999999',
      state: {
        step: 'awaiting_name',
        company_name_raw: 'ACME',
      },
      text: 'Joao Silva',
    });

    expect(result.state.step).toBe('awaiting_equipment_tag');
  });

  // ── 8. Dual-key: canonical contact_profile_prompt_* wins over profile_ask_* ──

  it('dual-key resolution: contact_profile_prompt_name wins over profile_ask_name', async () => {
    const service = makeService({
      contact_profile_prompt_name: 'Nome (canonical):',
      profile_ask_name: 'Nome (legacy):',
    });

    await service.getInitialPrompt();

    expect(service.getCollectionPrompt({ step: 'awaiting_name' }))
      .toBe('Nome (canonical):');
  });

  it('dual-key resolution: profile_ask_name used as fallback when canonical key absent', async () => {
    const service = makeService({
      profile_ask_name: 'Nome (legacy fallback):',
    });

    await service.getInitialPrompt();

    expect(service.getCollectionPrompt({ step: 'awaiting_name' }))
      .toBe('Nome (legacy fallback):');
  });

  // ── 9. Full step flow with requireEmail=false completes correctly ─────────

  it('full step flow completes without email step when requireEmail is false', async () => {
    const service = makeService({
      contact_profile_require_email: '0',
    });
    await service.getInitialPrompt();

    const phone = '+5511999999999';

    // awaiting_company -> awaiting_name
    const r1 = service.processCollectionResponse({
      phoneE164: phone,
      state: service.startNewCollectionState(),
      text: 'Empresa Teste',
    });
    expect(r1.state.step).toBe('awaiting_name');

    // awaiting_name -> awaiting_equipment_tag
    const r2 = service.processCollectionResponse({
      phoneE164: phone,
      state: r1.state,
      text: 'Ana Souza',
    });
    expect(r2.state.step).toBe('awaiting_equipment_tag');

    // awaiting_equipment_tag -> awaiting_problem_summary
    const r3 = service.processCollectionResponse({
      phoneE164: phone,
      state: r2.state,
      text: '1234',
    });
    expect(r3.state.step).toBe('awaiting_problem_summary');

    // awaiting_problem_summary -> complete
    const r4 = service.processCollectionResponse({
      phoneE164: phone,
      state: r3.state,
      text: 'Computador não liga',
    });
    expect(r4.state.step).toBe('complete');
    expect(r4.completed).toBe(true);
    expect(r4.profile).not.toBeNull();
    expect(r4.profile?.email_address).toBeNull();
  });

});
