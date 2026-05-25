import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { createInterface } from 'node:readline/promises';

import {
  type HistoricalMiningDataset,
  type HistoricalMiningInputFormat,
  type HistoricalMiningRejection,
  type HistoricalMiningRejectionReason,
  type HistoricalTicketRecord,
} from './types.js';
import {
  hashTicketIdentifier,
  hasObviousSensitiveContent,
  sanitizeHistoricalText,
  sha256Hex,
} from './sanitizer.js';

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

const REQUIRED_NON_EMPTY_FIELDS = [
  'ticket_id_hash',
  'opened_at',
  'status',
] as const;

const SUPPORTED_STATUSES = new Set([
  'new',
  'processing',
  'planned',
  'pending',
  'solved',
  'closed',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
]);

const EXPECTED_SCHEMA_VERSION = 'historical_mining_jsonl_v1';
const MINIMUM_CONTENT_CHARS = 20;

type RawRecord = Record<string, unknown>;
type RecordMappingResult =
  | { ok: true; record: HistoricalTicketRecord }
  | { ok: false; rejection: HistoricalMiningRejection };

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

function lineNumber(raw: RawRecord): number {
  const parsed = Number(raw.__line_number);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function reject(
  raw: RawRecord,
  reason: HistoricalMiningRejectionReason,
  field?: string,
  excerpt?: string,
): RecordMappingResult {
  return {
    ok: false,
    rejection: {
      line: lineNumber(raw),
      reason,
      field,
      ticketIdHash: String(raw.ticket_id_hash ?? '').trim() !== ''
        ? hashTicketIdentifier(raw.ticket_id_hash)
        : undefined,
      excerpt: excerpt ? sanitizeHistoricalText(excerpt, 180) : undefined,
    },
  };
}

function hasOwn(raw: RawRecord, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(raw, field);
}

function parseReopenCount(raw: RawRecord): number {
  const count = numberOrNull(raw.reopened_count);
  if (count !== null) {
    return Math.max(0, Math.floor(count));
  }
  const flag = String(raw.reopened ?? raw.reopened_flag ?? '').trim().toLowerCase();
  return ['true', 'yes', 'sim', '1'].includes(flag) ? 1 : 0;
}

function missingRequiredField(raw: RawRecord): string | null {
  for (const field of REQUIRED_FIELDS) {
    if (!hasOwn(raw, field)) {
      return field;
    }
  }
  for (const field of REQUIRED_NON_EMPTY_FIELDS) {
    if (String(raw[field] ?? '').trim() === '') {
      return field;
    }
  }

  return null;
}

function normalizedLabel(value: unknown, fallback: string, maxLength: number): string {
  const sanitized = sanitizeHistoricalText(value, maxLength);
  return sanitized !== '' ? sanitized : fallback;
}

function combinedSanitizedText(record: HistoricalTicketRecord): string {
  return [
    record.titleText,
    record.descriptionText,
    record.followupText,
    record.solutionText,
  ].filter(Boolean).join(' ').trim();
}

function mapRawRecord(raw: RawRecord): RecordMappingResult {
  if (raw.__invalid_json === true) {
    return reject(raw, 'invalid_json');
  }
  if (
    raw.schema_version !== undefined
    && String(raw.schema_version).trim() !== ''
    && String(raw.schema_version).trim() !== EXPECTED_SCHEMA_VERSION
  ) {
    return reject(raw, 'schema_version_mismatch', 'schema_version');
  }

  const missingField = missingRequiredField(raw);
  if (missingField !== null) {
    return reject(raw, 'missing_required_field', missingField);
  }

  const openedAt = parseDate(raw.opened_at);
  if (!openedAt) {
    return reject(raw, 'schema_version_mismatch', 'opened_at');
  }

  const status = sanitizeHistoricalText(raw.status, 80).toLowerCase();
  if (!SUPPORTED_STATUSES.has(status)) {
    return reject(raw, 'unsupported_status', 'status', status);
  }

  const record: HistoricalTicketRecord = {
    ticketIdHash: hashTicketIdentifier(raw.ticket_id_hash),
    openedAt,
    solvedAt: parseDate(raw.solved_at),
    status,
    category: normalizedLabel(raw.category, 'Sem categoria', 160),
    entity: normalizedLabel(raw.entity, 'Sem entidade', 160),
    group: normalizedLabel(raw.group, 'Sem grupo', 160),
    priority: raw.priority === undefined ? null : sanitizeHistoricalText(raw.priority, 60),
    urgency: raw.urgency === undefined ? null : sanitizeHistoricalText(raw.urgency, 60),
    titleText: sanitizeHistoricalText(raw.title_text_sanitized, 400),
    descriptionText: sanitizeHistoricalText(raw.description_text_sanitized, 1_200),
    followupText: sanitizeHistoricalText(raw.followup_text_sanitized, 1_200),
    solutionText: sanitizeHistoricalText(raw.solution_text_sanitized, 1_200),
    reopenedCount: parseReopenCount(raw),
    satisfactionScore: numberOrNull(raw.satisfaction_score),
  };

  const text = combinedSanitizedText(record);
  if (text === '') {
    return reject(raw, 'empty_sanitized_text', undefined, text);
  }
  if (text.length < MINIMUM_CONTENT_CHARS) {
    return reject(raw, 'below_minimum_content', undefined, text);
  }
  if (hasObviousSensitiveContent(text)) {
    return reject(raw, 'sensitive_data_residual', undefined, text);
  }

  return { ok: true, record };
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
  let lineNumberValue = 0;
  for await (const line of lineReader) {
    lineNumberValue += 1;
    const trimmed = line.trim();
    if (trimmed === '') {
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        yield { ...(parsed as RawRecord), __line_number: lineNumberValue };
      } else {
        yield { __line_number: lineNumberValue, __invalid_json: true };
      }
    } catch {
      yield { __line_number: lineNumberValue, __invalid_json: true };
    }
  }
}

async function* readCsv(inputPath: string): AsyncGenerator<RawRecord> {
  const content = await readFile(inputPath, 'utf8');
  const lines = content.split(/\r?\n/).filter((line) => line.trim() !== '');
  const headers = parseCsvLine(lines.shift() ?? '').map((header) => header.trim());
  let lineNumberValue = 1;
  for (const line of lines) {
    lineNumberValue += 1;
    const values = parseCsvLine(line);
    const row: RawRecord = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? '';
    });
    row.__line_number = lineNumberValue;
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
  const rejectionReasonCounts: Partial<Record<HistoricalMiningRejectionReason, number>> = {};
  const rejectionExamples: HistoricalMiningRejection[] = [];
  let rowsSeen = 0;
  let rowsRejected = 0;
  const reader = format === 'jsonl' ? readJsonl(inputPath) : readCsv(inputPath);

  for await (const raw of reader) {
    rowsSeen += 1;
    let mapping: RecordMappingResult;
    try {
      mapping = mapRawRecord(raw);
    } catch {
      mapping = reject(raw, 'unknown_error');
    }
    if (!mapping.ok) {
      rowsRejected += 1;
      const reason = mapping.rejection.reason;
      rejectionReasonCounts[reason] = (rejectionReasonCounts[reason] ?? 0) + 1;
      if (rejectionExamples.length < 5) {
        rejectionExamples.push(mapping.rejection);
      }
      continue;
    }
    const record = mapping.record;
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
    rejectionReasonCounts,
    rejectionExamples,
  };
}
