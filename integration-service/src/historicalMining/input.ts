import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { createInterface } from 'node:readline/promises';

import {
  type HistoricalMiningDataset,
  type HistoricalMiningInputFormat,
  type HistoricalTicketRecord,
} from './types.js';
import { hashTicketIdentifier, sanitizeHistoricalText, sha256Hex } from './sanitizer.js';

export interface HistoricalMiningLoadOptions {
  windowStart?: Date;
  windowEnd?: Date;
  maxRows: number;
}

const REQUIRED_FIELDS = [
  'ticket_id_hash',
  'opened_at',
  'status',
  'category',
  'entity',
  'group',
  'title_text_sanitized',
  'description_text_sanitized',
  'followup_text_sanitized',
  'solution_text_sanitized',
] as const;

type RawRecord = Record<string, unknown>;

export function detectHistoricalInputFormat(inputPath: string): HistoricalMiningInputFormat {
  const extension = extname(inputPath).toLowerCase();
  if (extension === '.jsonl') {
    return 'jsonl';
  }
  if (extension === '.csv') {
    return 'csv';
  }
  throw new Error('HISTORICAL_MINING_UNSUPPORTED_INPUT_FORMAT');
}

export function validateHistoricalWindow(windowStart?: Date, windowEnd?: Date): void {
  if (windowStart && Number.isNaN(windowStart.getTime())) {
    throw new Error('HISTORICAL_MINING_INVALID_WINDOW_START');
  }
  if (windowEnd && Number.isNaN(windowEnd.getTime())) {
    throw new Error('HISTORICAL_MINING_INVALID_WINDOW_END');
  }
  if (windowStart && windowEnd && windowStart.getTime() > windowEnd.getTime()) {
    throw new Error('HISTORICAL_MINING_INVALID_WINDOW_RANGE');
  }
}

export function validateMaxRows(maxRows: number): number {
  if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > 100_000) {
    throw new Error('HISTORICAL_MINING_INVALID_MAX_ROWS');
  }
  return maxRows;
}

export async function computeFileHash(inputPath: string): Promise<string> {
  const hash = createHash('sha256');
  const stream = createReadStream(inputPath);
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

function parseDate(value: unknown): Date | null {
  const text = String(value ?? '').trim();
  if (text === '') {
    return null;
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || String(value).trim() === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseReopenCount(raw: RawRecord): number {
  const count = numberOrNull(raw.reopened_count);
  if (count !== null) {
    return Math.max(0, Math.floor(count));
  }
  const flag = String(raw.reopened ?? raw.reopened_flag ?? '').trim().toLowerCase();
  return ['true', 'yes', 'sim', '1'].includes(flag) ? 1 : 0;
}

function requiredFieldsPresent(raw: RawRecord): boolean {
  return REQUIRED_FIELDS.every((field) => String(raw[field] ?? '').trim() !== '');
}

function mapRawRecord(raw: RawRecord): HistoricalTicketRecord | null {
  if (!requiredFieldsPresent(raw)) {
    return null;
  }

  const openedAt = parseDate(raw.opened_at);
  if (!openedAt) {
    return null;
  }

  return {
    ticketIdHash: hashTicketIdentifier(raw.ticket_id_hash),
    openedAt,
    solvedAt: parseDate(raw.solved_at),
    status: sanitizeHistoricalText(raw.status, 80),
    category: sanitizeHistoricalText(raw.category, 160),
    entity: sanitizeHistoricalText(raw.entity, 160),
    group: sanitizeHistoricalText(raw.group, 160),
    priority: raw.priority === undefined ? null : sanitizeHistoricalText(raw.priority, 60),
    urgency: raw.urgency === undefined ? null : sanitizeHistoricalText(raw.urgency, 60),
    titleText: sanitizeHistoricalText(raw.title_text_sanitized, 400),
    descriptionText: sanitizeHistoricalText(raw.description_text_sanitized, 1_200),
    followupText: sanitizeHistoricalText(raw.followup_text_sanitized, 1_200),
    solutionText: sanitizeHistoricalText(raw.solution_text_sanitized, 1_200),
    reopenedCount: parseReopenCount(raw),
    satisfactionScore: numberOrNull(raw.satisfaction_score),
  };
}

function recordInWindow(record: HistoricalTicketRecord, windowStart?: Date, windowEnd?: Date): boolean {
  const opened = record.openedAt.getTime();
  return (!windowStart || opened >= windowStart.getTime())
    && (!windowEnd || opened <= windowEnd.getTime());
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === ',' && !quoted) {
      values.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  values.push(current);
  return values.map((value) => value.trim());
}

async function* readJsonl(inputPath: string): AsyncGenerator<RawRecord> {
  const lineReader = createInterface({
    input: createReadStream(inputPath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of lineReader) {
    const trimmed = line.trim();
    if (trimmed === '') {
      continue;
    }
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      yield parsed as RawRecord;
    } else {
      yield {};
    }
  }
}

async function* readCsv(inputPath: string): AsyncGenerator<RawRecord> {
  const content = await readFile(inputPath, 'utf8');
  const lines = content.split(/\r?\n/).filter((line) => line.trim() !== '');
  const headers = parseCsvLine(lines.shift() ?? '').map((header) => header.trim());
  for (const line of lines) {
    const values = parseCsvLine(line);
    const row: RawRecord = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? '';
    });
    yield row;
  }
}

export async function loadHistoricalMiningDataset(
  inputPath: string,
  options: HistoricalMiningLoadOptions,
): Promise<HistoricalMiningDataset> {
  validateHistoricalWindow(options.windowStart, options.windowEnd);
  const maxRows = validateMaxRows(options.maxRows);
  const format = detectHistoricalInputFormat(inputPath);
  const inputHash = await computeFileHash(inputPath);
  const records: HistoricalTicketRecord[] = [];
  let rowsSeen = 0;
  let rowsRejected = 0;
  const reader = format === 'jsonl' ? readJsonl(inputPath) : readCsv(inputPath);

  for await (const raw of reader) {
    rowsSeen += 1;
    let record: HistoricalTicketRecord | null = null;
    try {
      record = mapRawRecord(raw);
    } catch {
      record = null;
    }
    if (!record) {
      rowsRejected += 1;
      continue;
    }
    if (!recordInWindow(record, options.windowStart, options.windowEnd)) {
      continue;
    }
    records.push(record);
    if (records.length >= maxRows) {
      break;
    }
  }

  return {
    inputHash: inputHash || sha256Hex(inputPath),
    rowsSeen,
    rowsRejected,
    records,
  };
}
