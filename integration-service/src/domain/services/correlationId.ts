import { randomBytes } from 'node:crypto';

const CORRELATION_ID_PATTERN = /^WA-\d{14}-[a-f0-9]{6}$/;

function timestampForCorrelationId(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');

  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
  ].join('');
}

export function createCorrelationId(date = new Date()): string {
  return `WA-${timestampForCorrelationId(date)}-${randomBytes(3).toString('hex')}`;
}

export function normalizeCorrelationId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 128) {
    return null;
  }

  return normalized;
}

export function getOrCreateCorrelationId(value: unknown): string {
  return normalizeCorrelationId(value) ?? createCorrelationId();
}

export function isGeneratedCorrelationId(value: string): boolean {
  return CORRELATION_ID_PATTERN.test(value);
}
