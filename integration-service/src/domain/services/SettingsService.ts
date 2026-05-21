import type { SettingsRepository } from '../repositories/SettingsRepository.js';

import { logger } from '../../infra/logger/logger.js';

const SETTINGS_CACHE_TTL_MS = 5 * 60 * 1000;

const FALLBACKS = {
  menu_message: 'Escolha uma opção:',
  invalid_option_message: 'Não entendi sua opção. Por favor, escolha uma das opções abaixo:',
  invalid_media_message: 'Por favor, envie apenas texto para escolher uma opção.',
  error_fallback_message: 'Tivemos uma instabilidade. Tente novamente mais tarde.',
  ticket_created_message: 'Seu chamado #{ticket_id} foi aberto.',
  // Loaded now so closed-conversation responses can use config without another settings migration later.
  conversation_closed_message: 'Esta conversa está encerrada. Inicie um novo atendimento.',
  // Loaded now for the future after-hours flow; 7.8B only consumes existing inbound messages.
  after_hours_message: 'Estamos fora do horário. Retornamos amanhã.',
} as const;

export type MessageSettingKey = keyof typeof FALLBACKS;

export interface ContactProfileConfig {
  collectionEnabled: boolean;
  promptMode: 'hybrid' | 'single_message' | 'step_by_step';
  requireCompany: boolean;
  requireName: boolean;
  requireEquipment: boolean;
  requireSummary: boolean;
  confirmationEnabled: boolean;
  useButtons: boolean;
  titleEnrichmentEnabled: boolean;
  promptName: string;
  promptCompany: string;
  promptEquipment: string;
  promptSummary: string;
  confirmMessage: string;
}

export interface InactivityRuntimeConfig {
  enabled: boolean | null;
  reminderMinutes: [number, number, number] | null;
  autocloseMinutes: number | null;
}

const CONTACT_PROFILE_DEFAULTS: ContactProfileConfig = {
  collectionEnabled: false,
  promptMode: 'hybrid',
  requireCompany: true,
  requireName: true,
  requireEquipment: false,
  requireSummary: true,
  confirmationEnabled: true,
  useButtons: true,
  titleEnrichmentEnabled: true,
  promptName: 'Por favor, informe seu nome.',
  promptCompany: 'Por favor, informe a empresa.',
  promptEquipment: 'Informe o equipamento (opcional).',
  promptSummary: 'Descreva resumidamente o problema.',
  confirmMessage: 'Confirma as informações para abrir o chamado?',
};

interface SettingsCacheState {
  expiresAt: number;
  values: Map<string, string>;
}

let globalCache: SettingsCacheState | null = null;
let globalReload: Promise<Map<string, string>> | null = null;

export function clearSettingsCacheForTests(): void {
  globalCache = null;
  globalReload = null;
}

export function normalizeBooleanSetting(value: unknown, defaultValue: boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    if (value === 1) {
      return true;
    }
    if (value === 0) {
      return false;
    }
    return defaultValue;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === '') {
      return defaultValue;
    }
    if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
      return true;
    }
    if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
      return false;
    }
  }

  return defaultValue;
}

export class SettingsService {
  public constructor(private readonly repository: SettingsRepository) {}

  public async getMessage(key: MessageSettingKey): Promise<string> {
    const values = await this.getCachedSettings();
    const fallback = FALLBACKS[key];
    const rawValue = values.get(key);

    if (rawValue === undefined) {
      logger.info({ key, reason: 'missing_key' }, '[config][FALLBACK]');
      return fallback;
    }

    const value = rawValue.trim();
    if (value === '') {
      logger.info({ key, reason: 'empty_value' }, '[config][FALLBACK]');
      return fallback;
    }

    return value;
  }

  public async formatMessage(
    key: MessageSettingKey,
    placeholders: { ticketId?: number | string } = {},
  ): Promise<string> {
    const message = await this.getMessage(key);
    const ticketId = placeholders.ticketId;

    if (ticketId === undefined || ticketId === null) {
      return message;
    }

    return message.replace(/\{ticket_id\}/g, String(ticketId));
  }

  public async getContactProfileConfig(): Promise<ContactProfileConfig> {
    try {
      const rawValues = await this.repository.findContactProfileSettings();

      return {
        collectionEnabled: this.toBooleanOrDefault(
          rawValues.get('contact_profile_collection_enabled'),
          CONTACT_PROFILE_DEFAULTS.collectionEnabled,
        ),
        promptMode: this.toPromptModeOrDefault(
          rawValues.get('contact_profile_prompt_mode'),
          CONTACT_PROFILE_DEFAULTS.promptMode,
        ),
        requireCompany: this.toBooleanOrDefault(
          rawValues.get('contact_profile_require_company'),
          CONTACT_PROFILE_DEFAULTS.requireCompany,
        ),
        requireName: this.toBooleanOrDefault(
          rawValues.get('contact_profile_require_name'),
          CONTACT_PROFILE_DEFAULTS.requireName,
        ),
        requireEquipment: this.toBooleanOrDefault(
          rawValues.get('contact_profile_require_equipment'),
          CONTACT_PROFILE_DEFAULTS.requireEquipment,
        ),
        requireSummary: this.toBooleanOrDefault(
          rawValues.get('contact_profile_require_summary'),
          CONTACT_PROFILE_DEFAULTS.requireSummary,
        ),
        confirmationEnabled: this.toBooleanOrDefault(
          rawValues.get('contact_profile_confirmation_enabled'),
          CONTACT_PROFILE_DEFAULTS.confirmationEnabled,
        ),
        useButtons: this.toBooleanOrDefault(
          rawValues.get('contact_profile_use_buttons'),
          CONTACT_PROFILE_DEFAULTS.useButtons,
        ),
        titleEnrichmentEnabled: this.toBooleanOrDefault(
          rawValues.get('ticket_title_enrichment_enabled'),
          CONTACT_PROFILE_DEFAULTS.titleEnrichmentEnabled,
        ),
        promptName: this.toStringOrDefault(
          rawValues.get('profile_ask_name') ?? rawValues.get('contact_profile_prompt_name'),
          CONTACT_PROFILE_DEFAULTS.promptName,
        ),
        promptCompany: this.toStringOrDefault(
          rawValues.get('profile_ask_company') ?? rawValues.get('contact_profile_prompt_company'),
          CONTACT_PROFILE_DEFAULTS.promptCompany,
        ),
        promptEquipment: this.toStringOrDefault(
          rawValues.get('profile_ask_equipment') ?? rawValues.get('contact_profile_prompt_equipment'),
          CONTACT_PROFILE_DEFAULTS.promptEquipment,
        ),
        promptSummary: this.toStringOrDefault(
          rawValues.get('profile_ask_summary') ?? rawValues.get('contact_profile_prompt_summary'),
          CONTACT_PROFILE_DEFAULTS.promptSummary,
        ),
        confirmMessage: this.toStringOrDefault(
          rawValues.get('profile_confirmation_message') ?? rawValues.get('contact_profile_confirm_message'),
          CONTACT_PROFILE_DEFAULTS.confirmMessage,
        ),
      };
    } catch (error: unknown) {
      logger.error(
        {
          error: error instanceof Error ? { message: error.message, name: error.name } : String(error),
        },
        '[config][CONTACT_PROFILE_ERROR]',
      );
      return { ...CONTACT_PROFILE_DEFAULTS };
    }
  }

  public async getInactivityRuntimeConfig(): Promise<InactivityRuntimeConfig> {
    try {
      const rawValues = await this.repository.findInactivitySettings();
      const r1 = this.toPositiveIntegerOrNull(rawValues.get('inactivity_reminder_1_minutes'));
      const r2 = this.toPositiveIntegerOrNull(rawValues.get('inactivity_reminder_2_minutes'));
      const r3 = this.toPositiveIntegerOrNull(rawValues.get('inactivity_reminder_3_minutes'));
      const autoclose = this.toPositiveIntegerOrNull(rawValues.get('inactivity_autoclose_minutes'));
      const reminderMinutes = r1 !== null && r2 !== null && r3 !== null && r1 < r2 && r2 < r3
        ? [r1, r2, r3] as [number, number, number]
        : null;

      return {
        enabled: rawValues.has('inactivity_enabled')
          ? this.toBooleanOrDefault(rawValues.get('inactivity_enabled'), false)
          : null,
        reminderMinutes,
        autocloseMinutes: autoclose,
      };
    } catch (error: unknown) {
      logger.error(
        {
          error: error instanceof Error ? { message: error.message, name: error.name } : String(error),
        },
        '[config][INACTIVITY_ERROR]',
      );

      return {
        enabled: null,
        reminderMinutes: null,
        autocloseMinutes: null,
      };
    }
  }

  private toBooleanOrDefault(value: unknown, defaultValue: boolean): boolean {
    return normalizeBooleanSetting(value, defaultValue);
  }

  private toPromptModeOrDefault(value: unknown, defaultValue: ContactProfileConfig['promptMode']) {
    if (typeof value !== 'string') {
      return defaultValue;
    }

    const normalized = value.trim().toLowerCase();
    if (normalized === '') {
      return defaultValue;
    }

    if (normalized === 'hybrid' || normalized === 'single_message' || normalized === 'step_by_step') {
      return normalized;
    }

    return defaultValue;
  }

  private toStringOrDefault(value: unknown, defaultValue: string): string {
    if (typeof value !== 'string') {
      return defaultValue;
    }

    const normalized = value.trim();
    if (normalized === '') {
      return defaultValue;
    }

    return normalized;
  }

  private toPositiveIntegerOrNull(value: unknown): number | null {
    const parsed = typeof value === 'number'
      ? value
      : Number.parseInt(String(value ?? '').trim(), 10);

    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }

  private async getCachedSettings(): Promise<Map<string, string>> {
    const now = Date.now();
    if (globalCache && globalCache.expiresAt > now) {
      logger.debug(
        { ttl_remaining_ms: globalCache.expiresAt - now },
        '[config][CACHE_HIT]',
      );
      return globalCache.values;
    }

    if (!globalReload) {
      globalReload = this.reloadSettings().finally(() => {
        globalReload = null;
      });
    }

    return await globalReload;
  }

  private async reloadSettings(): Promise<Map<string, string>> {
    try {
      const values = await this.repository.findMessageSettings();
      globalCache = {
        values,
        expiresAt: Date.now() + SETTINGS_CACHE_TTL_MS,
      };
      logger.info({ keys_count: values.size, ttl_ms: SETTINGS_CACHE_TTL_MS }, '[config][SETTINGS_LOADED]');

      return values;
    } catch (error: unknown) {
      logger.error(
        {
          error: error instanceof Error ? { message: error.message, name: error.name } : String(error),
        },
        '[config][ERROR]',
      );

      globalCache = {
        values: new Map(),
        expiresAt: Date.now() + SETTINGS_CACHE_TTL_MS,
      };

      return globalCache.values;
    }
  }
}
