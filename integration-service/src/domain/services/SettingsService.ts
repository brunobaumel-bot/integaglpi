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
      logger.info({ keys_count: values.size, ttl_ms: SETTINGS_CACHE_TTL_MS }, '[config][LOAD]');

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
