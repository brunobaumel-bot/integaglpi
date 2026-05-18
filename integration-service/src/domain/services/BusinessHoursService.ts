import { logger } from '../../infra/logger/logger.js';
import type { BusinessHoursConfigRecord, MessageFlowRepository } from '../../repositories/contracts/MessageFlowRepository.js';

const CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

interface CacheState {
  expiresAt: number;
  value: BusinessHoursConfigRecord;
}

export interface BusinessHoursDecision {
  enabled: boolean;
  isOpen: boolean;
  eventKey: string;
  cooldownMinutes: number;
  reason: string;
}

export class BusinessHoursService {
  private cache: CacheState | null = null;

  public constructor(
    private readonly repository: MessageFlowRepository | null,
    private readonly nowProvider: () => Date = () => new Date(),
  ) {}

  public async evaluate(): Promise<BusinessHoursDecision> {
    const config = await this.getConfig();
    if (!config.enabled) {
      return {
        enabled: false,
        isOpen: true,
        eventKey: config.eventKey,
        cooldownMinutes: config.cooldownMinutes,
        reason: 'business_hours_disabled',
      };
    }

    try {
      const zoned = this.toZonedDate(this.nowProvider(), config.timezone);
      const day = zoned.getDay();
      const window = this.getDayWindow(day, config);
      if (!window.enabled) {
        return {
          enabled: true,
          isOpen: false,
          eventKey: config.eventKey,
          cooldownMinutes: config.cooldownMinutes,
          reason: 'closed_day',
        };
      }

      const start = parseTimeToMinutes(window.start);
      const end = parseTimeToMinutes(window.end);
      if (start === null || end === null) {
        logger.warn(
          { day, start_time: window.start, end_time: window.end },
          '[business_hours][INVALID_CONFIG]',
        );
        return {
          enabled: true,
          isOpen: true,
          eventKey: config.eventKey,
          cooldownMinutes: config.cooldownMinutes,
          reason: 'invalid_config_fails_open',
        };
      }

      const current = zoned.getHours() * 60 + zoned.getMinutes();

      return {
        enabled: true,
        isOpen: current >= start && current < end,
        eventKey: config.eventKey,
        cooldownMinutes: config.cooldownMinutes,
        reason: current >= start && current < end ? 'inside_hours' : 'outside_time_window',
      };
    } catch (error: unknown) {
      logger.warn(
        {
          timezone: config.timezone,
          fallback_timezone: DEFAULT_TIMEZONE,
          error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
        },
        '[business_hours][EVALUATION_FAILED]',
      );

      return {
        enabled: true,
        isOpen: true,
        eventKey: config.eventKey,
        cooldownMinutes: config.cooldownMinutes,
        reason: 'evaluation_failed_fails_open',
      };
    }
  }

  public async shouldSendOutsideHoursMessage(
    conversationId: string | null,
    phoneE164: string | null,
    eventKey: string,
    cooldownMinutes: number,
  ): Promise<boolean> {
    if (!this.repository) {
      return true;
    }

    const lastSentAt = await this.repository.findLastAutomationEvent(
      conversationId,
      phoneE164,
      eventKey,
      ['sent', 'planned'],
    );
    if (!lastSentAt) {
      return true;
    }

    const elapsedMs = this.nowProvider().getTime() - lastSentAt.getTime();
    const cooldownMs = Math.max(1, cooldownMinutes) * 60_000;
    if (elapsedMs >= cooldownMs) {
      return true;
    }

    logger.info(
      {
        conversation_id: conversationId,
        phone_masked: phoneE164 ? maskPhone(phoneE164) : null,
        event_key: eventKey,
        ttl_remaining_ms: cooldownMs - elapsedMs,
      },
      '[business_hours][COOLDOWN_SKIPPED]',
    );

    return false;
  }

  private async getConfig(): Promise<BusinessHoursConfigRecord> {
    const now = Date.now();
    if (this.cache && this.cache.expiresAt > now) {
      return this.cache.value;
    }

    let value = defaultConfig();
    if (this.repository) {
      try {
        value = await this.repository.findBusinessHoursConfig() ?? value;
      } catch (error: unknown) {
        logger.warn(
          {
            error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
          },
          '[business_hours][CONFIG_FALLBACK]',
        );
      }
    }

    this.cache = { value, expiresAt: now + CACHE_TTL_MS };
    return value;
  }

  private getDayWindow(day: number, config: BusinessHoursConfigRecord): { enabled: boolean; start: string; end: string } {
    if (day >= 1 && day <= 5) {
      return { enabled: true, start: config.weekdayStart, end: config.weekdayEnd };
    }

    if (day === 6) {
      return {
        enabled: config.saturdayEnabled,
        start: config.saturdayStart || config.weekdayStart,
        end: config.saturdayEnd || config.weekdayEnd,
      };
    }

    return {
      enabled: config.sundayEnabled,
      start: config.sundayStart || config.weekdayStart,
      end: config.sundayEnd || config.weekdayEnd,
    };
  }

  private toZonedDate(date: Date, timezone: string): Date {
    return new Date(date.toLocaleString('en-US', { timeZone: timezone || DEFAULT_TIMEZONE }));
  }
}

function defaultConfig(): BusinessHoursConfigRecord {
  return {
    enabled: false,
    timezone: DEFAULT_TIMEZONE,
    weekdayStart: '08:00',
    weekdayEnd: '18:00',
    saturdayEnabled: false,
    saturdayStart: null,
    saturdayEnd: null,
    sundayEnabled: false,
    sundayStart: null,
    sundayEnd: null,
    holidayBehavior: 'normal',
    eventKey: 'outside_business_hours_message',
    cooldownMinutes: 60,
  };
}

function parseTimeToMinutes(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) {
    return null;
  }

  return Number(match[1]) * 60 + Number(match[2]);
}

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length <= 4) {
    return '****';
  }

  return `${digits.slice(0, 2)}******${digits.slice(-4)}`;
}
