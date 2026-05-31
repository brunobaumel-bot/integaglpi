import type { SettingsRepository } from '../repositories/SettingsRepository.js';
import type { ContactProfilePersistenceRepository } from '../repositories/ContactProfilePersistenceRepository.js';
import { normalizeBooleanSetting, type ContactProfileConfig } from './SettingsService.js';

export interface ContactProfileData {
  phone_e164: string;
  requester_name: string | null;
  email_address?: string | null;
  email_status?: 'valid' | 'invalid' | 'not_provided';
  glpi_user_id?: number | null;
  glpi_user_link_status?: string | null;
  glpi_user_link_source?: string | null;
  glpi_user_linked_at?: string | null;
  glpi_user_created_by_integaglpi?: boolean;
  company_name_raw: string | null;
  last_equipment_tag: string | null;
  equipment_tag_unknown: boolean;
  last_problem_summary: string | null;
  profile_status: 'incomplete' | 'complete' | 'needs_update';
  profile_source: 'whatsapp' | 'manual';
  confirmation_count: number;
  last_confirmed_at: string;
  last_conversation_id?: string | null;
}

export interface ContactProfileTicketPayload {
  title: string;
  content: string;
}

export type ContactProfileCollectionStep =
  | 'confirming_existing_profile'
  | 'asking_company'
  | 'asking_name'
  | 'asking_email'
  | 'asking_tag'
  | 'asking_reason'
  | 'complete';

export interface ContactProfileCollectionState {
  [key: string]: unknown;
  step: ContactProfileCollectionStep;
  queue_label?: string | null;
  company_name_raw?: string | null;
  requester_name?: string | null;
  email_address?: string | null;
  email_status?: 'valid' | 'invalid' | 'not_provided';
  last_equipment_tag?: string | null;
  equipment_tag_unknown?: boolean;
  reason?: string | null;
}

export interface ContactProfileCollectionResult {
  state: ContactProfileCollectionState;
  reply: string;
  completed: boolean;
  profile: ContactProfileData | null;
}

const EQUIPMENT_UNKNOWN_RE = /^(nao sei|não sei|nao tenho|não tenho|sem etiqueta|nao aparece|não aparece|desconheco|desconheço)$/i;
const EMAIL_SKIP_RE = /^(nao informar|não informar|nao tenho|não tenho|sem email|sem e-mail|pular|depois)$/i;
const PROFILE_CHANGE_RE = /^(alterar dados|corrigir cadastro|\/dados|outro equipamento)$/i;
const PROFILE_YES_RE = /^(sim|s|yes|y|continuar|sim, continuar|profile_confirm_yes)$/i;
const PROFILE_NO_RE = /^(nao|não|n|no|corrigir|alterar|profile_confirm_no)$/i;
const EQUIPMENT_TAG_RE = /^\d{4}$/;
const MAX_REASON_LENGTH = 200;
const MAX_TITLE_REASON_LENGTH = 60;
const MAX_TITLE_LENGTH = 200;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const DEFAULT_INITIAL_PROMPT = [
  'Perfeito! Vou agilizar seu atendimento.',
  '',
  'Envie em uma unica mensagem:',
  'Empresa ou unidade, seu nome, etiqueta/patrimonio se souber, e um resumo curto do problema.',
  '',
  'Se nao souber a etiqueta, pode escrever "nao sei".',
].join('\n');

/**
 * Ponte entre configuração `contact_profile` (GLPI configs) e perfil persistido no Postgres.
 * Não altera o fluxo inbound existente até ser injetado explicitamente no grafo de dependências.
 */
export class ContactProfileService {
  // Populated by getInitialPrompt() — which is always called before the step flow starts.
  // getCollectionPrompt() and processCollectionResponse() use this cache when available.
  // Falls back to hardcoded defaults for code paths that skip getInitialPrompt().
  private configCache: ContactProfileConfig | null = null;

  public constructor(
    private readonly settingsRepository: SettingsRepository,
    private readonly contactProfilePersistenceRepository: ContactProfilePersistenceRepository,
  ) {}

  private async loadAndCacheConfig(): Promise<ContactProfileConfig> {
    if (this.configCache !== null) {
      return this.configCache;
    }
    const rawValues = await this.settingsRepository.findContactProfileSettings();
    const toStr = (key: string, fallback: string): string => {
      const v = rawValues.get(key);
      if (typeof v !== 'string') return fallback;
      const t = v.trim();
      return t !== '' ? t : fallback;
    };
    const toBool = (key: string, fallback: boolean): boolean =>
      normalizeBooleanSetting(rawValues.get(key), fallback);

    this.configCache = {
      collectionEnabled: toBool('contact_profile_collection_enabled', false),
      promptMode: 'hybrid',
      requireCompany: toBool('contact_profile_require_company', true),
      requireName: toBool('contact_profile_require_name', true),
      requireEmail: toBool('contact_profile_require_email', true),  // absent → ask email (backward compat)
      requireEquipment: toBool('contact_profile_require_equipment', false),
      requireSummary: toBool('contact_profile_require_summary', true),
      confirmationEnabled: toBool('contact_profile_confirmation_enabled', true),
      useButtons: toBool('contact_profile_use_buttons', true),
      titleEnrichmentEnabled: toBool('ticket_title_enrichment_enabled', true),
      initialPrompt: toStr('contact_profile_initial_prompt',
        toStr('profile_initial_prompt', DEFAULT_INITIAL_PROMPT)),
      promptCompany: toStr('contact_profile_prompt_company',
        toStr('profile_ask_company', 'Informe a empresa ou unidade.')),
      promptName: toStr('contact_profile_prompt_name',
        toStr('profile_ask_name', 'Informe seu nome completo.')),
      promptEmail: toStr('contact_profile_prompt_email',
        toStr('profile_ask_email', 'Informe seu e-mail (ou responda "não informar").')),
      promptEquipment: toStr('contact_profile_prompt_equipment',
        toStr('profile_ask_equipment', 'Informe a etiqueta/patrimônio do equipamento.')),
      promptSummary: toStr('contact_profile_prompt_summary',
        toStr('profile_ask_summary', 'Qual o motivo do seu contato? Resuma em até 200 caracteres.')),
      confirmMessage: toStr('contact_profile_confirm_message',
        toStr('profile_confirmation_message', 'Obrigado. Seus dados foram registrados.')),
    };
    return this.configCache;
  }

  /**
   * Carrega flags de configuração e snapshot persistido. Usa apenas métodos obrigatórios do repositório
   * (sem optional chaining) para manter contrato explícito em tempo de compilação.
   */
  public async loadProfileBundle(phoneE164: string): Promise<{
    settings: Map<string, unknown>;
    persisted: Record<string, unknown> | null;
  }> {
    const settings = await this.settingsRepository.findContactProfileSettings();
    const row = await this.contactProfilePersistenceRepository.findByPhoneE164(phoneE164);

    return {
      settings,
      persisted: row?.profile ?? null,
    };
  }

  public async isCollectionEnabled(): Promise<boolean> {
    const settings = await this.settingsRepository.findContactProfileSettings();
    return normalizeBooleanSetting(settings.get('contact_profile_collection_enabled'), false);
  }

  public async findProfile(phoneE164: string): Promise<ContactProfileData | null> {
    const row = await this.contactProfilePersistenceRepository.findByPhoneE164(phoneE164);
    return row ? this.normalizeProfile(row.profile) : null;
  }

  public async saveProfileFromText(
    _contactId: string,
    phoneE164: string,
    text: string,
    conversationId?: string | null,
  ): Promise<ContactProfileData> {
    const profile = {
      ...this.parseProfileText(phoneE164, text),
      last_conversation_id: conversationId ?? null,
    };
    profile.profile_status = await this.isProfileComplete(profile) ? 'complete' : 'incomplete';
    await this.contactProfilePersistenceRepository.upsertProfile(
      phoneE164,
      profile as unknown as Record<string, unknown>,
    );

    return profile;
  }

  public async saveProfileData(
    phoneE164: string,
    profile: ContactProfileData,
    conversationId?: string | null,
  ): Promise<ContactProfileData> {
    const persistedProfile: ContactProfileData = {
      ...profile,
      phone_e164: phoneE164,
      last_conversation_id: conversationId ?? profile.last_conversation_id ?? null,
      profile_status: await this.isProfileComplete(profile) ? 'complete' : 'incomplete',
      profile_source: profile.profile_source ?? 'whatsapp',
      confirmation_count: Number(profile.confirmation_count) || 1,
      last_confirmed_at: profile.last_confirmed_at || new Date().toISOString(),
    };

    await this.contactProfilePersistenceRepository.upsertProfile(
      phoneE164,
      persistedProfile as unknown as Record<string, unknown>,
    );

    return persistedProfile;
  }

  public async createSnapshot(
    conversationId: string,
    contactId: string,
    phoneE164: string,
    profile: ContactProfileData | null,
  ): Promise<ContactProfileData | null> {
    const effectiveProfile = profile ?? await this.findProfile(phoneE164);
    if (!effectiveProfile) {
      return null;
    }

    const snapshotPhoneE164 = effectiveProfile.phone_e164 || phoneE164;

    await this.contactProfilePersistenceRepository.upsertSnapshot(conversationId, snapshotPhoneE164, {
      ...effectiveProfile,
      phone_e164: snapshotPhoneE164,
      source_contact_id: contactId,
      snapshot_created_at: new Date().toISOString(),
    });

    return effectiveProfile;
  }

  public async isProfileComplete(profile: ContactProfileData): Promise<boolean> {
    const settings = await this.settingsRepository.findContactProfileSettings();
    const requireName = normalizeBooleanSetting(settings.get('contact_profile_require_name'), true);
    const requireCompany = normalizeBooleanSetting(settings.get('contact_profile_require_company'), true);
    const requireEquipment = normalizeBooleanSetting(settings.get('contact_profile_require_equipment'), false);
    const requireSummary = normalizeBooleanSetting(settings.get('contact_profile_require_summary'), true);

    return (!requireName || this.cleanText(profile.requester_name) !== '')
      && (!requireCompany || this.cleanText(profile.company_name_raw) !== '')
      && (!requireEquipment || profile.equipment_tag_unknown || this.isValidEquipmentTag(profile.last_equipment_tag))
      && (!requireSummary || this.cleanText(profile.last_problem_summary) !== '');
  }

  public isReliableForConfirmation(profile: ContactProfileData | null | undefined): profile is ContactProfileData {
    if (!profile || profile.profile_status !== 'complete') {
      return false;
    }

    if (this.cleanText(profile.requester_name) === '' || this.cleanText(profile.company_name_raw) === '') {
      return false;
    }

    return profile.equipment_tag_unknown === true || this.isValidEquipmentTag(profile.last_equipment_tag);
  }

  public async buildMissingFieldsPrompt(profile: ContactProfileData): Promise<string> {
    const settings = await this.settingsRepository.findContactProfileSettings();
    const missing: string[] = [];

    if (
      normalizeBooleanSetting(settings.get('contact_profile_require_name'), true)
      && this.cleanText(profile.requester_name) === ''
    ) {
      missing.push('nome');
    }
    if (
      normalizeBooleanSetting(settings.get('contact_profile_require_company'), true)
      && this.cleanText(profile.company_name_raw) === ''
    ) {
      missing.push('empresa ou unidade');
    }
    if (
      normalizeBooleanSetting(settings.get('contact_profile_require_equipment'), false)
      && !profile.equipment_tag_unknown
      && this.cleanText(profile.last_equipment_tag) === ''
    ) {
      missing.push('etiqueta/patrimonio ou "nao sei"');
    }
    if (
      normalizeBooleanSetting(settings.get('contact_profile_require_summary'), true)
      && this.cleanText(profile.last_problem_summary) === ''
    ) {
      missing.push('resumo do problema');
    }

    if (missing.length === 0) {
      return 'Obrigado. Seus dados foram registrados.';
    }

    return `Ainda preciso de: ${missing.join(', ')}. Envie essas informacoes para continuar.`;
  }

  public async findSnapshot(conversationId: string): Promise<ContactProfileData | null> {
    const row = await this.contactProfilePersistenceRepository.findSnapshotByConversationId(conversationId);
    return row ? this.normalizeProfile(row.snapshotJson) : null;
  }

  public startNewCollectionState(queueLabel?: string | null): ContactProfileCollectionState {
    return {
      step: 'asking_company',
      queue_label: queueLabel ?? null,
      equipment_tag_unknown: false,
    };
  }

  public startExistingProfileConfirmationState(
    profile: ContactProfileData,
    queueLabel?: string | null,
  ): ContactProfileCollectionState {
    return {
      step: 'confirming_existing_profile',
      queue_label: queueLabel ?? null,
      company_name_raw: profile.company_name_raw,
      requester_name: profile.requester_name,
      email_address: profile.email_address,
      email_status: profile.email_status ?? (profile.email_address ? 'valid' : 'not_provided'),
      last_equipment_tag: profile.last_equipment_tag,
      equipment_tag_unknown: profile.equipment_tag_unknown,
      reason: profile.last_problem_summary,
    };
  }

  public normalizeCollectionState(value: unknown): ContactProfileCollectionState {
    const raw = typeof value === 'object' && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
    const step = this.asCollectionStep(raw.step);

    return {
      step: step ?? 'asking_company',
      queue_label: this.asNullableString(raw.queue_label),
      company_name_raw: this.asNullableString(raw.company_name_raw),
      requester_name: this.asNullableString(raw.requester_name),
      email_address: this.asNullableString(raw.email_address),
      email_status: this.asEmailStatus(raw.email_status),
      last_equipment_tag: this.asNullableString(raw.last_equipment_tag),
      equipment_tag_unknown: normalizeBooleanSetting(raw.equipment_tag_unknown, false),
      reason: this.asNullableString(raw.reason),
    };
  }

  public getCollectionPrompt(state: ContactProfileCollectionState, profile: ContactProfileData | null = null): string {
    if (state.step === 'confirming_existing_profile') {
      return this.buildExistingProfileConfirmationPrompt(profile ?? this.profileFromState('', state));
    }

    // configCache is populated by getInitialPrompt() before the step flow starts.
    // Falls back to hardcoded strings for code paths that bypass getInitialPrompt().
    const cfg = this.configCache;

    if (state.step === 'asking_company') {
      return cfg?.promptCompany ?? 'Informe a empresa ou unidade.';
    }

    if (state.step === 'asking_name') {
      return cfg?.promptName ?? 'Informe seu nome completo.';
    }

    if (state.step === 'asking_email') {
      return cfg?.promptEmail ?? 'Informe seu e-mail para localizarmos seu cadastro no GLPI. Se preferir, responda "não informar".';
    }

    if (state.step === 'asking_tag') {
      return cfg?.promptEquipment ?? 'Informe a etiqueta/patrimônio do equipamento com 4 números. Se não souber, use o botão "Não sei".';
    }

    if (state.step === 'asking_reason') {
      return cfg?.promptSummary ?? 'Qual o motivo do seu contato? Resuma em até 200 caracteres.';
    }

    return cfg?.confirmMessage ?? 'Obrigado. Seus dados foram registrados.';
  }

  public processCollectionResponse(input: {
    phoneE164: string;
    state: ContactProfileCollectionState;
    text: string;
    existingProfile?: ContactProfileData | null;
  }): ContactProfileCollectionResult {
    const text = this.cleanText(input.text);
    const state = this.normalizeCollectionState(input.state);

    if (!text) {
      return {
        state,
        reply: this.getCollectionPrompt(state, input.existingProfile ?? null),
        completed: false,
        profile: null,
      };
    }

    if (state.step === 'confirming_existing_profile') {
      if (PROFILE_YES_RE.test(text)) {
        const nextState = this.stateFromProfile(
          input.existingProfile ?? this.profileFromState(input.phoneE164, state),
          state.queue_label,
        );
        if (this.cleanText(nextState.reason) !== '') {
          const completeState: ContactProfileCollectionState = {
            ...nextState,
            step: 'complete',
          };
          return {
            state: completeState,
            reply: `${this.buildConfirmedProfileSummary(completeState)}\n\n${this.getCollectionPrompt(completeState)}`,
            completed: true,
            profile: this.profileFromState(input.phoneE164, completeState),
          };
        }

        return {
          state: nextState,
          reply: `${this.buildConfirmedProfileSummary(nextState)}\n\n${this.getCollectionPrompt(nextState)}`,
          completed: false,
          profile: null,
        };
      }

      if (PROFILE_NO_RE.test(text)) {
        const nextState = this.startNewCollectionState(state.queue_label ?? null);
        return {
          state: nextState,
          reply: this.getCollectionPrompt(nextState),
          completed: false,
          profile: null,
        };
      }

      return {
        state,
        reply: `${this.buildExistingProfileConfirmationPrompt(input.existingProfile ?? this.profileFromState(input.phoneE164, state))}\n\nResponda Sim ou Nao.`,
        completed: false,
        profile: null,
      };
    }

    if (state.step === 'asking_company') {
      const nextState: ContactProfileCollectionState = {
        ...state,
        step: 'asking_name',
        company_name_raw: this.truncate(text, 120),
      };
      return { state: nextState, reply: this.getCollectionPrompt(nextState), completed: false, profile: null };
    }

    if (state.step === 'asking_name') {
      // Skip email step when disabled in config (requireEmail defaults to true for
      // backward-compatibility when configCache has not been warmed up).
      const requireEmail = this.configCache?.requireEmail ?? true;
      const nextStep: ContactProfileCollectionStep = requireEmail ? 'asking_email' : 'asking_tag';
      const nextState: ContactProfileCollectionState = {
        ...state,
        step: nextStep,
        requester_name: this.truncate(text, 120),
      };
      return { state: nextState, reply: this.getCollectionPrompt(nextState), completed: false, profile: null };
    }

    if (state.step === 'asking_email') {
      const normalizedEmail = this.normalizeEmail(text);
      const skipped = EMAIL_SKIP_RE.test(text);
      const nextState: ContactProfileCollectionState = {
        ...state,
        step: 'asking_tag',
        email_address: normalizedEmail,
        email_status: normalizedEmail ? 'valid' : skipped ? 'not_provided' : 'invalid',
      };
      const prefix = !normalizedEmail && !skipped
        ? 'Não consegui validar esse e-mail agora, mas isso não impede o atendimento.\n\n'
        : '';
      return {
        state: nextState,
        reply: `${prefix}${this.getCollectionPrompt(nextState)}`,
        completed: false,
        profile: null,
      };
    }

    if (state.step === 'asking_tag') {
      if (EQUIPMENT_UNKNOWN_RE.test(text) || text.toUpperCase() === 'TAG_UNKNOWN') {
        const nextState: ContactProfileCollectionState = {
          ...state,
          step: 'asking_reason',
          last_equipment_tag: null,
          equipment_tag_unknown: true,
        };
        return { state: nextState, reply: this.getCollectionPrompt(nextState), completed: false, profile: null };
      }

      if (!EQUIPMENT_TAG_RE.test(text)) {
        return {
          state,
          reply:
            'Etiqueta inválida. Informe exatamente 4 números, por exemplo 2022 ou 0640, ou use o botão "Não sei" ou responda "não sei".',
          completed: false,
          profile: null,
        };
      }

      const nextState: ContactProfileCollectionState = {
        ...state,
        step: 'asking_reason',
        last_equipment_tag: text,
        equipment_tag_unknown: false,
      };
      return { state: nextState, reply: this.getCollectionPrompt(nextState), completed: false, profile: null };
    }

    if (state.step === 'asking_reason') {
      const reason = this.truncate(text, MAX_REASON_LENGTH);
      const completeState: ContactProfileCollectionState = {
        ...state,
        step: 'complete',
        reason,
      };
      const profile = this.profileFromState(input.phoneE164, completeState);
      return {
        state: completeState,
        reply: 'Obrigado. Seus dados foram registrados.',
        completed: true,
        profile,
      };
    }

    if (state.step === 'complete') {
      return {
        state,
        reply: this.getCollectionPrompt(state),
        completed: true,
        profile: this.profileFromState(input.phoneE164, state),
      };
    }

    return {
      state,
      reply: 'Obrigado. Seus dados foram registrados.',
      completed: false,
      profile: null,
    };
  }

  public async enrichTicketPayload(input: {
    baseTitle: string;
    baseContent: string;
    phoneE164: string;
    queueLabel: string | null;
    profile: ContactProfileData | null;
    entityMode?: 'use_default_entity' | 'defer_until_known' | string | null;
    awaitedManualEntity?: boolean;
    manualEntityActor?: string | null;
  }): Promise<ContactProfileTicketPayload> {
    const settings = await this.settingsRepository.findContactProfileSettings();
    if (!normalizeBooleanSetting(settings.get('ticket_title_enrichment_enabled'), true) || !input.profile) {
      return {
        title: input.baseTitle,
        content: input.baseContent,
      };
    }

    const profile = input.profile;
    const queueLabel = this.cleanText(input.queueLabel || 'WhatsApp');
    const company = this.cleanText(profile.company_name_raw);
    const requesterName = this.cleanText(profile.requester_name);
    const summary = this.cleanText(profile.last_problem_summary);
    const companyOrPhone = company || requesterName || input.phoneE164;
    const shortReason = this.truncate(summary || 'Atendimento', MAX_TITLE_REASON_LENGTH);
    const titleParts = [companyOrPhone];
    if (requesterName && requesterName !== companyOrPhone) {
      titleParts.push(requesterName);
    }
    titleParts.push(shortReason);
    const title = this.truncate(`[WA][${queueLabel}] ${titleParts.join(' — ')}`, MAX_TITLE_LENGTH);
    const equipmentLabel = profile.equipment_tag_unknown
      ? 'nao informada'
      : (this.cleanText(profile.last_equipment_tag) || '(n/d)');
    const contextLines = [
      'Atendimento iniciado via WhatsApp',
      '',
      `Telefone: ${input.phoneE164}`,
      `Nome informado: ${this.cleanText(profile.requester_name) || '(n/d)'}`,
      `E-mail informado: ${this.cleanText(profile.email_address) || '(não informado)'}`,
      `Empresa informada: ${this.cleanText(profile.company_name_raw) || '(n/d)'}`,
      `Etiqueta/Patrimonio: ${equipmentLabel}`,
      `Motivo informado: ${summary || '(n/d)'}`,
      `Fila escolhida: ${queueLabel}`,
      `Modo de entidade: ${this.cleanText(input.entityMode || 'defer_until_known')}`,
    ];

    if (input.awaitedManualEntity) {
      contextLines.push('Observacao: atendimento aguardou selecao manual de entidade antes da abertura do chamado.');
    }

    if (input.manualEntityActor) {
      contextLines.push(`Entidade atribuida manualmente por: ${this.cleanText(input.manualEntityActor)}`);
    }

    contextLines.push('', 'Mensagens iniciais:', input.baseContent);

    return {
      title,
      content: contextLines.join('\n'),
    };
  }

  public parseProfileText(phoneE164: string, text: string): ContactProfileData {
    const now = new Date().toISOString();
    const trimmed = text.trim();
    if (PROFILE_CHANGE_RE.test(trimmed)) {
      return {
        phone_e164: phoneE164,
        requester_name: null,
        email_address: null,
        email_status: 'not_provided',
        company_name_raw: null,
        last_equipment_tag: null,
        equipment_tag_unknown: false,
        last_problem_summary: null,
        profile_status: 'needs_update',
      profile_source: 'whatsapp',
      confirmation_count: 0,
      last_confirmed_at: now,
      last_conversation_id: null,
      };
    }

    const labeled = this.parseLabeledParts(trimmed);
    const parts = trimmed
      .split(/[\n,;|-]+/)
      .map((part) => part.trim())
      .filter(Boolean);
    const company = labeled.company ?? parts[0] ?? null;
    const requester = labeled.name ?? parts[1] ?? null;
    const normalizedEmail = this.normalizeEmail(labeled.email ?? parts[2] ?? '');
    const rawEquipment = labeled.equipment ?? (normalizedEmail ? parts[3] : parts[2]) ?? null;
    const equipmentUnknown = rawEquipment !== null && EQUIPMENT_UNKNOWN_RE.test(rawEquipment);
    const summaryStartIndex = normalizedEmail ? 4 : 3;
    const summary = labeled.summary ?? (parts.length > summaryStartIndex ? parts.slice(summaryStartIndex).join(' ') : null);
    const hasMinimumProfile = Boolean(company && requester && summary);

    return {
      phone_e164: phoneE164,
      company_name_raw: company,
      requester_name: requester,
      email_address: normalizedEmail,
      email_status: normalizedEmail ? 'valid' : 'not_provided',
      last_equipment_tag: equipmentUnknown ? null : rawEquipment,
      equipment_tag_unknown: equipmentUnknown,
      last_problem_summary: summary,
      profile_status: hasMinimumProfile ? 'complete' : 'incomplete',
      profile_source: 'whatsapp',
      confirmation_count: 1,
      last_confirmed_at: now,
      last_conversation_id: null,
    };
  }

  public async getInitialPrompt(): Promise<string> {
    // Warms up configCache as a side-effect so subsequent sync calls to
    // getCollectionPrompt() and processCollectionResponse() use configured texts.
    const config = await this.loadAndCacheConfig();
    return config.initialPrompt.trim().length > 0 ? config.initialPrompt : DEFAULT_INITIAL_PROMPT;
  }

  private parseLabeledParts(text: string): {
    company?: string;
    name?: string;
    email?: string;
    equipment?: string;
    summary?: string;
  } {
    const output: { company?: string; name?: string; email?: string; equipment?: string; summary?: string } = {};
    const patterns: Array<[keyof typeof output, RegExp]> = [
      ['company', /\bempresa\s*[:=-]\s*([^;\n,]+)/i],
      ['company', /\bunidade\s*[:=-]\s*([^;\n,]+)/i],
      ['name', /\bnome\s*[:=-]\s*([^;\n,]+)/i],
      ['email', /\be-?mail\s*[:=-]\s*([^;\n,]+)/i],
      ['equipment', /\betiqueta\s*[:=-]\s*([^;\n,]+)/i],
      ['equipment', /\bpatrimonio\s*[:=-]\s*([^;\n,]+)/i],
      ['equipment', /\bpatrimônio\s*[:=-]\s*([^;\n,]+)/i],
      ['summary', /\bproblema\s*[:=-]\s*([^;\n]+)/i],
      ['summary', /\bresumo\s*[:=-]\s*([^;\n]+)/i],
    ];

    for (const [key, pattern] of patterns) {
      const match = pattern.exec(text);
      if (match?.[1]) {
        output[key] = match[1].trim();
      }
    }

    return output;
  }

  private buildExistingProfileConfirmationPrompt(profile: ContactProfileData | null): string {
    const name = this.cleanText(profile?.requester_name) || 'tudo bem';
    const company = this.cleanText(profile?.company_name_raw) || '(empresa nao informada)';
    const equipment = profile?.equipment_tag_unknown
      ? 'sua etiqueta ainda nao esta informada'
      : `sua etiqueta e ${this.cleanText(profile?.last_equipment_tag) || '(nao informada)'}`;

    return [
      `Bom dia, ${name}.`,
      '',
      `Voce fala da empresa ${company} e ${equipment}.`,
      `E-mail cadastrado: ${this.cleanText(profile?.email_address) || 'nao informado'}.`,
      '',
      'As informacoes estao corretas? Responda Sim ou Nao.',
    ].join('\n');
  }

  private buildConfirmedProfileSummary(state: ContactProfileCollectionState): string {
    const company = this.cleanText(state.company_name_raw) || '(empresa nao informada)';
    const equipment = state.equipment_tag_unknown
      ? 'nao informada'
      : (this.cleanText(state.last_equipment_tag) || '(nao informada)');

    return `Dados confirmados: empresa ${company}; etiqueta ${equipment}.`;
  }

  private stateFromProfile(
    profile: ContactProfileData,
    queueLabel?: string | null,
  ): ContactProfileCollectionState {
    return {
      step: 'asking_reason',
      queue_label: queueLabel ?? null,
      company_name_raw: profile.company_name_raw,
      requester_name: profile.requester_name,
      email_address: profile.email_address,
      email_status: profile.email_status ?? (profile.email_address ? 'valid' : 'not_provided'),
      last_equipment_tag: profile.equipment_tag_unknown ? null : profile.last_equipment_tag,
      equipment_tag_unknown: profile.equipment_tag_unknown,
      reason: profile.last_problem_summary ?? null,
    };
  }

  private profileFromState(phoneE164: string, state: ContactProfileCollectionState): ContactProfileData {
    const now = new Date().toISOString();

    return {
      phone_e164: phoneE164,
      requester_name: state.requester_name ?? null,
      email_address: this.normalizeEmail(state.email_address ?? ''),
      email_status: state.email_status ?? (this.normalizeEmail(state.email_address ?? '') ? 'valid' : 'not_provided'),
      company_name_raw: state.company_name_raw ?? null,
      last_equipment_tag: state.equipment_tag_unknown ? null : state.last_equipment_tag ?? null,
      equipment_tag_unknown: state.equipment_tag_unknown === true,
      last_problem_summary: state.reason ?? null,
      profile_status: 'complete',
      profile_source: 'whatsapp',
      confirmation_count: 1,
      last_confirmed_at: now,
      last_conversation_id: null,
    };
  }

  private asCollectionStep(value: unknown): ContactProfileCollectionStep | null {
    return value === 'confirming_existing_profile'
      || value === 'asking_company'
      || value === 'asking_name'
      || value === 'asking_email'
      || value === 'asking_tag'
      || value === 'asking_reason'
      || value === 'complete'
      ? value
      : null;
  }

  private normalizeProfile(value: Record<string, unknown>): ContactProfileData {
    return {
      phone_e164: this.asString(value.phone_e164),
      requester_name: this.asNullableString(value.requester_name),
      email_address: this.normalizeEmail(value.email_address),
      email_status: this.asEmailStatus(value.email_status),
      glpi_user_id: this.asPositiveInteger(value.glpi_user_id),
      glpi_user_link_status: this.asNullableString(value.glpi_user_link_status),
      glpi_user_link_source: this.asNullableString(value.glpi_user_link_source),
      glpi_user_linked_at: this.asNullableString(value.glpi_user_linked_at),
      glpi_user_created_by_integaglpi: normalizeBooleanSetting(value.glpi_user_created_by_integaglpi, false),
      company_name_raw: this.asNullableString(value.company_name_raw),
      last_equipment_tag: this.asNullableString(value.last_equipment_tag),
      equipment_tag_unknown: normalizeBooleanSetting(value.equipment_tag_unknown, false),
      last_problem_summary: this.asNullableString(value.last_problem_summary),
      profile_status: this.asProfileStatus(value.profile_status),
      profile_source: 'whatsapp',
      confirmation_count: Number(value.confirmation_count) || 0,
      last_confirmed_at: this.asString(value.last_confirmed_at) || new Date().toISOString(),
      last_conversation_id: this.asNullableString(value.last_conversation_id),
    };
  }

  private asProfileStatus(value: unknown): ContactProfileData['profile_status'] {
    return value === 'complete' || value === 'needs_update' ? value : 'incomplete';
  }

  private asNullableString(value: unknown): string | null {
    const normalized = this.asString(value);
    return normalized === '' ? null : normalized;
  }

  private asEmailStatus(value: unknown): 'valid' | 'invalid' | 'not_provided' {
    return value === 'valid' || value === 'invalid' || value === 'not_provided' ? value : 'not_provided';
  }

  public normalizeEmail(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const normalized = value.trim().toLowerCase();
    return EMAIL_RE.test(normalized) ? normalized : null;
  }

  private asString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private asPositiveInteger(value: unknown): number | null {
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
      return value;
    }

    if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
      const parsed = Number.parseInt(value, 10);
      return parsed > 0 ? parsed : null;
    }

    return null;
  }

  private cleanText(value: string | null | undefined): string {
    return (value ?? '')
      .replace(/<[^>]*>/g, '')
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/[\u0000-\u001F\u007F]+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private isValidEquipmentTag(value: string | null | undefined): boolean {
    return EQUIPMENT_TAG_RE.test(this.cleanText(value));
  }

  private truncate(value: string, maxLength: number): string {
    return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3).trimEnd()}...`;
  }
}
