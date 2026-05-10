import type { SettingsRepository } from '../repositories/SettingsRepository.js';

import { logger } from '../../infra/logger/logger.js';

const BUSINESS_HOURS_CACHE_TTL_MS = 5 * 60 * 1000;
const AFTER_HOURS_RATE_LIMIT_TTL_MS = 60 * 60 * 1000;
const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

interface BusinessHoursConfig {
  businessDays: number[];
  endTime: string;
  hoursEnabled: boolean;
  startTime: string;
  timezone: string;
}

interface BusinessHoursCacheState {
  expiresAt: number;
  value: BusinessHoursConfig;
}

let globalBusinessHoursCache: BusinessHoursCacheState | null = null;
const afterHoursNotifiedByPhone = new Map<string, number>();

export function clearScheduleCacheForTests(): void {
  globalBusinessHoursCache = null;
  afterHoursNotifiedByPhone.clear();
}

export class ScheduleService {
  public constructor(
    private readonly repository: SettingsRepository,
    private readonly nowProvider: () => Date = () => new Date(),
  ) {}

  public async isOpen(): Promise<boolean> {
    const config = await this.getConfig();

    if (!config.hoursEnabled) {
      return true;
    }

    const now = this.getZonedDate(config.timezone);
    const day = now.getDay();

    if (!config.businessDays.includes(day)) {
      return false;
    }

    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const startMinutes = ScheduleService.parseTimeToMinutes(config.startTime);
    const endMinutes = ScheduleService.parseTimeToMinutes(config.endTime);

    if (startMinutes === null || endMinutes === null) {
      logger.warn(
        {
          start_time: config.startTime,
          end_time: config.endTime,
        },
        '[schedule][CONFIG_INVALID]',
      );
      return true;
    }

    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }

  public shouldSendAfterHoursMessage(phoneE164: string): boolean {
    const now = Date.now();
    const lastSentAt = afterHoursNotifiedByPhone.get(phoneE164);

    if (lastSentAt !== undefined && now - lastSentAt < AFTER_HOURS_RATE_LIMIT_TTL_MS) {
      logger.info(
        {
          phone_e164: phoneE164,
          ttl_remaining_ms: AFTER_HOURS_RATE_LIMIT_TTL_MS - (now - lastSentAt),
        },
        '[schedule][SKIP_RATE_LIMIT]',
      );
      return false;
    }

    afterHoursNotifiedByPhone.set(phoneE164, now);
    return true;
  }

  private async getConfig(): Promise<BusinessHoursConfig> {
    const now = Date.now();
    if (globalBusinessHoursCache && globalBusinessHoursCache.expiresAt > now) {
      return globalBusinessHoursCache.value;
    }

    const raw = await this.repository.findBusinessHoursSettings();
    const value = ScheduleService.mapConfig(raw);
    globalBusinessHoursCache = {
      value,
      expiresAt: now + BUSINESS_HOURS_CACHE_TTL_MS,
    };

    return value;
  }

  private getZonedDate(timezone: string): Date {
    try {
      const zonedDate = ScheduleService.toZonedDate(this.nowProvider(), timezone);
      if (Number.isNaN(zonedDate.getTime())) {
        throw new Error('Invalid zoned date');
      }

      return zonedDate;
    } catch (error: unknown) {
      logger.warn(
        {
          timezone,
          fallback_timezone: DEFAULT_TIMEZONE,
          error: error instanceof Error ? { message: error.message, name: error.name } : String(error),
        },
        '[schedule][INVALID_TIMEZONE]',
      );

      const fallbackDate = ScheduleService.toZonedDate(this.nowProvider(), DEFAULT_TIMEZONE);
      if (!Number.isNaN(fallbackDate.getTime())) {
        return fallbackDate;
      }

      return new Date(this.nowProvider().getTime());
    }
  }

  private static toZonedDate(date: Date, timezone: string): Date {
    return new Date(date.toLocaleString('en-US', { timeZone: timezone }));
  }

  private static mapConfig(raw: Map<string, unknown>): BusinessHoursConfig {
    return {
      businessDays: ScheduleService.parseBusinessDays(raw.get('business_days')),
      endTime: ScheduleService.asString(raw.get('end_time')) || '18:00',
      hoursEnabled: ScheduleService.asEnabled(raw.get('hours_enabled')),
      startTime: ScheduleService.asString(raw.get('start_time')) || '08:00',
      timezone: ScheduleService.asString(raw.get('timezone')) || DEFAULT_TIMEZONE,
    };
  }

  private static asEnabled(value: unknown): boolean {
    if (value === true || value === 1) {
      return true;
    }

    if (typeof value === 'string') {
      return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
    }

    return false;
  }

  private static asString(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }

  private static parseBusinessDays(value: unknown): number[] {
    if (Array.isArray(value)) {
      return ScheduleService.normalizeBusinessDays(value);
    }

    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value) as unknown;
        if (Array.isArray(parsed)) {
          return ScheduleService.normalizeBusinessDays(parsed);
        }
      } catch {
        return [1, 2, 3, 4, 5];
      }
    }

    return [1, 2, 3, 4, 5];
  }

  private static normalizeBusinessDays(values: unknown[]): number[] {
    const days = values
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6);

    return [...new Set(days)];
  }

  private static parseTimeToMinutes(value: string): number | null {
    const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
    if (!match) {
      return null;
    }

    return Number(match[1]) * 60 + Number(match[2]);
  }
}
