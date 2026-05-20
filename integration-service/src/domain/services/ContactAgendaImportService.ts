import { randomUUID } from 'node:crypto';
import { setImmediate as yieldToEventLoop } from 'node:timers/promises';

import type { KeyLock } from '../contracts/KeyLock.js';
import type { AuditService } from './AuditService.js';
import type {
  ContactAgendaImportRepository,
  ContactImportBatchRecord,
  ContactImportItemInput,
  ContactImportItemRecord,
  ExistingContactProfileRecord,
} from '../../repositories/contracts/ContactAgendaImportRepository.js';

export const CONTACT_IMPORT_MAX_LINES = 1000;
export const CONTACT_IMPORT_CHUNK_SIZE = 100;

type HeaderKey = 'phone' | 'email' | 'name' | 'company' | 'equipmentTag';

interface ParsedRow {
  rowNumber: number;
  values: Partial<Record<HeaderKey, string>>;
}

export interface ContactImportPreviewInput {
  filename: string;
  csvContent: string;
  uploadedBy: number | null;
}

export interface ContactImportConfirmInput {
  batchId: string;
  confirmedBy: number | null;
}

export interface ContactImportRollbackInput {
  batchId: string;
  requestedBy: number | null;
  reason: string;
}

export interface ContactImportResult {
  batch: ContactImportBatchRecord;
  items: ContactImportItemView[];
}

export interface ContactImportItemView {
  item_id: number;
  row_number: number;
  phone_masked: string;
  email_masked: string;
  contact_name: string | null;
  company_name: string | null;
  equipment_tag: string | null;
  validation_status: string;
  validation_errors: string[];
  dedup_status: string;
  action_planned: string;
  action_applied: string;
}

export class ContactAgendaImportError extends Error {
  public constructor(
    public readonly errorCode: string,
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
  }
}

function sanitizeFilename(value: string): string {
  const clean = value.replace(/[^\w.\- ]+/g, '').trim();
  return clean.slice(0, 180) || 'agenda.csv';
}

function sanitizeText(value: string | undefined, maxLength: number): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const clean = value
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return clean === '' ? null : clean.slice(0, maxLength);
}

function normalizeEmail(value: string | undefined): string | null {
  const clean = sanitizeText(value, 254)?.toLowerCase() ?? null;
  if (!clean) {
    return null;
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean) ? clean : clean;
}

function isValidEmail(value: string | null): boolean {
  return value === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalizePhone(value: string | undefined): string | null {
  const raw = sanitizeText(value, 40);
  if (!raw) {
    return null;
  }

  let digits = raw.replace(/\D+/g, '');
  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }
  if (digits.length < 10 || digits.length > 15) {
    return null;
  }

  return `+${digits}`;
}

function parseEquipmentTag(value: string | undefined): { tag: string | null; unknown: boolean; valid: boolean } {
  const clean = sanitizeText(value, 40);
  if (!clean) {
    return { tag: null, unknown: false, valid: true };
  }

  const normalized = clean
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
  if (normalized === 'nao sei' || normalized === 'naosei') {
    return { tag: null, unknown: true, valid: true };
  }

  if (/^\d{4}$/.test(clean)) {
    return { tag: clean, unknown: false, valid: true };
  }

  return { tag: null, unknown: false, valid: false };
}

function maskPhone(value: string | null): string {
  if (!value) {
    return '';
  }
  const digits = value.replace(/\D+/g, '');
  if (digits.length <= 4) {
    return '****';
  }

  return `+${digits.slice(0, 2)}******${digits.slice(-4)}`;
}

function maskEmail(value: string | null): string {
  if (!value) {
    return '';
  }
  const [local, domain] = value.split('@');
  if (!local || !domain) {
    return '***';
  }
  return `${local.slice(0, 1)}***@${domain}`;
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === ',' && !inQuotes) {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function parseCsv(content: string): ParsedRow[] {
  const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n').filter((line) => line.trim() !== '');
  if (lines.length < 2) {
    throw new ContactAgendaImportError('CSV_EMPTY', 'CSV deve conter cabeçalho e ao menos uma linha.');
  }
  if (lines.length - 1 > CONTACT_IMPORT_MAX_LINES) {
    throw new ContactAgendaImportError('CSV_TOO_LARGE', `CSV excede o limite de ${CONTACT_IMPORT_MAX_LINES} linhas.`);
  }

  const headers = splitCsvLine(lines[0]).map((header) => header.trim().toLowerCase());
  const headerMap = new Map<number, HeaderKey>();
  const aliases: Record<string, HeaderKey> = {
    telefone: 'phone',
    phone: 'phone',
    phone_e164: 'phone',
    whatsapp: 'phone',
    email: 'email',
    'e-mail': 'email',
    nome: 'name',
    name: 'name',
    contato: 'name',
    empresa: 'company',
    company: 'company',
    companhia: 'company',
    etiqueta: 'equipmentTag',
    patrimonio: 'equipmentTag',
    patrimony: 'equipmentTag',
    equipment_tag: 'equipmentTag',
  };

  headers.forEach((header, index) => {
    const normalizedHeader = header.normalize('NFD').replace(/\p{Diacritic}/gu, '');
    const mapped = aliases[normalizedHeader] ?? aliases[header];
    if (mapped) {
      headerMap.set(index, mapped);
    }
  });

  if (![...headerMap.values()].includes('phone')) {
    throw new ContactAgendaImportError('CSV_PHONE_HEADER_REQUIRED', 'CSV precisa de coluna telefone/phone.');
  }

  return lines.slice(1).map((line, index) => {
    const cells = splitCsvLine(line);
    const values: Partial<Record<HeaderKey, string>> = {};
    for (const [cellIndex, key] of headerMap.entries()) {
      values[key] = cells[cellIndex] ?? '';
    }
    return { rowNumber: index + 2, values };
  });
}

function mapItemView(item: ContactImportItemRecord): ContactImportItemView {
  return {
    item_id: item.itemId,
    row_number: item.rowNumber,
    phone_masked: maskPhone(item.phoneE164),
    email_masked: maskEmail(item.email),
    contact_name: item.contactName,
    company_name: item.companyName,
    equipment_tag: item.equipmentTag ?? (item.equipmentTagUnknown ? 'Não sei' : null),
    validation_status: item.validationStatus,
    validation_errors: item.validationErrors,
    dedup_status: item.dedupStatus,
    action_planned: item.actionPlanned,
    action_applied: item.actionApplied,
  };
}

function summarizeBatch(batch: ContactImportBatchRecord, items: ContactImportItemRecord[]): ContactImportResult {
  return {
    batch,
    items: items.map(mapItemView),
  };
}

export class ContactAgendaImportService {
  public constructor(
    private readonly repository: ContactAgendaImportRepository,
    private readonly auditService?: AuditService,
    private readonly keyLock?: KeyLock,
    private readonly options: { chunkSize?: number } = {},
  ) {}

  public async preview(input: ContactImportPreviewInput): Promise<ContactImportResult> {
    const filename = sanitizeFilename(input.filename);
    const parsedRows = parseCsv(input.csvContent);
    const normalizedRows = parsedRows.map((row) => this.normalizeRow(row));
    const dedupedRows = this.markDedup(normalizedRows, await this.loadExistingProfiles(normalizedRows));
    const batchId = randomUUID();
    const validRows = dedupedRows.filter((row) => row.validationStatus === 'valid' && row.dedupStatus !== 'conflict').length;
    const invalidRows = dedupedRows.filter((row) => row.validationStatus === 'invalid').length;
    const duplicateRows = dedupedRows.filter((row) => row.dedupStatus === 'duplicate').length;
    const conflictRows = dedupedRows.filter((row) => row.dedupStatus === 'conflict').length;

    await this.repository.createBatch({
      batchId,
      filename,
      uploadedBy: input.uploadedBy,
      totalRows: dedupedRows.length,
      validRows,
      invalidRows,
      duplicateRows,
      conflictRows,
    });
    const items = await this.repository.insertItems(batchId, dedupedRows);
    const batch = await this.requireBatch(batchId);

    await this.audit('CONTACT_IMPORT_PREVIEWED', 'success', {
      batch_id: batchId,
      uploaded_by: input.uploadedBy,
      total_rows: dedupedRows.length,
      valid_rows: validRows,
      invalid_rows: invalidRows,
      duplicate_rows: duplicateRows,
      conflict_rows: conflictRows,
    });

    return summarizeBatch(batch, items);
  }

  public async confirm(input: ContactImportConfirmInput): Promise<ContactImportResult> {
    const work = async () => {
      const batch = await this.requireBatch(input.batchId);
      if (batch.status !== 'previewed' && batch.status !== 'confirmed') {
        throw new ContactAgendaImportError('BATCH_NOT_CONFIRMABLE', 'Batch não está em estado confirmável.', 409);
      }

      await this.repository.updateBatchStatus(input.batchId, 'processing');
      await this.audit('CONTACT_IMPORT_CONFIRMED', 'success', {
        batch_id: input.batchId,
        confirmed_by: input.confirmedBy,
      });

      try {
        const items = await this.repository.listItems(input.batchId, { limit: CONTACT_IMPORT_MAX_LINES });
        const chunkSize = Math.max(1, this.options.chunkSize ?? CONTACT_IMPORT_CHUNK_SIZE);
        for (let index = 0; index < items.length; index += chunkSize) {
          const chunk = items.slice(index, index + chunkSize);
          for (const item of chunk) {
            await this.applyItem(item);
          }
          await yieldToEventLoop();
        }

        await this.repository.updateBatchStatus(input.batchId, 'completed');
        await this.audit('CONTACT_IMPORT_COMPLETED', 'success', {
          batch_id: input.batchId,
          total_rows: items.length,
          chunk_size: chunkSize,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
        await this.repository.updateBatchStatus(input.batchId, 'failed', message);
        await this.audit('CONTACT_IMPORT_FAILED', 'failed', {
          batch_id: input.batchId,
          error_message: message,
        });
        throw error;
      }

      return this.getStatus(input.batchId);
    };

    return this.keyLock
      ? this.keyLock.withLock(`contact-agenda-import:${input.batchId}`, work)
      : work();
  }

  public async getStatus(batchId: string): Promise<ContactImportResult> {
    const batch = await this.requireBatch(batchId);
    const items = await this.repository.listItems(batchId, { limit: CONTACT_IMPORT_MAX_LINES });
    return summarizeBatch(batch, items);
  }

  public async rollback(input: ContactImportRollbackInput): Promise<ContactImportResult> {
    const reason = sanitizeText(input.reason, 500);
    if (!reason) {
      throw new ContactAgendaImportError('ROLLBACK_REASON_REQUIRED', 'Justificativa do rollback é obrigatória.');
    }

    const work = async () => {
      const batch = await this.requireBatch(input.batchId);
      if (batch.status !== 'completed') {
        throw new ContactAgendaImportError('BATCH_NOT_ROLLBACKABLE', 'Apenas batches concluídos podem sofrer rollback.', 409);
      }
      const items = await this.repository.listItems(input.batchId, { limit: CONTACT_IMPORT_MAX_LINES });
      for (const item of items.filter((candidate) => candidate.actionApplied === 'created_profile' || candidate.actionApplied === 'updated_profile')) {
        try {
          if (item.actionApplied === 'created_profile' && item.targetContactProfileId) {
            await this.repository.markCreatedProfileInactive(item.targetContactProfileId);
          } else if (item.actionApplied === 'updated_profile' && item.targetContactProfileId && item.previousStateJson) {
            await this.repository.restoreProfileFromPreviousState(item.targetContactProfileId, item.previousStateJson);
          }
          await this.repository.markItemApplied(item.itemId, {
            actionApplied: 'rolled_back',
            targetContactProfileId: item.targetContactProfileId,
            previousStateJson: item.previousStateJson,
          });
          await this.repository.createRollbackRecord({
            batchId: input.batchId,
            itemId: item.itemId,
            reason,
            previousStateJson: item.previousStateJson,
            requestedBy: input.requestedBy,
            rollbackState: 'completed',
          });
        } catch (error: unknown) {
          await this.repository.createRollbackRecord({
            batchId: input.batchId,
            itemId: item.itemId,
            reason,
            previousStateJson: item.previousStateJson,
            requestedBy: input.requestedBy,
            rollbackState: 'failed',
          });
        }
      }

      await this.repository.updateBatchStatus(input.batchId, 'rolled_back');
      await this.audit('CONTACT_IMPORT_ROLLED_BACK', 'success', {
        batch_id: input.batchId,
        requested_by: input.requestedBy,
      });

      return this.getStatus(input.batchId);
    };

    return this.keyLock
      ? this.keyLock.withLock(`contact-agenda-import:${input.batchId}:rollback`, work)
      : work();
  }

  private normalizeRow(row: ParsedRow): ContactImportItemInput {
    const phoneE164 = normalizePhone(row.values.phone);
    const email = normalizeEmail(row.values.email);
    const equipment = parseEquipmentTag(row.values.equipmentTag);
    const validationErrors: string[] = [];

    if (!phoneE164) {
      validationErrors.push('telefone inválido');
    }
    if (!isValidEmail(email)) {
      validationErrors.push('e-mail inválido');
    }
    if (!equipment.valid) {
      validationErrors.push('etiqueta/patrimônio inválido');
    }

    return {
      rowNumber: row.rowNumber,
      phoneE164,
      email: isValidEmail(email) ? email : null,
      contactName: sanitizeText(row.values.name, 160),
      companyName: sanitizeText(row.values.company, 160),
      equipmentTag: equipment.tag,
      equipmentTagUnknown: equipment.unknown,
      validationStatus: validationErrors.length > 0 ? 'invalid' : 'valid',
      validationErrors,
      dedupStatus: 'new',
      actionPlanned: validationErrors.length > 0 ? 'none' : 'create_profile',
    };
  }

  private async loadExistingProfiles(items: ContactImportItemInput[]): Promise<ExistingContactProfileRecord[]> {
    return this.repository.findExistingProfiles({
      phoneE164Values: [...new Set(items.map((item) => item.phoneE164).filter((value): value is string => !!value))],
      emailValues: [...new Set(items.map((item) => item.email).filter((value): value is string => !!value))],
      equipmentTagValues: [...new Set(items.map((item) => item.equipmentTag).filter((value): value is string => !!value))],
    });
  }

  private markDedup(
    items: ContactImportItemInput[],
    existingProfiles: ExistingContactProfileRecord[],
  ): ContactImportItemInput[] {
    const phoneSeen = new Set<string>();
    const byPhone = new Map(existingProfiles.map((profile) => [profile.phoneE164, profile]));
    const byEmail = new Map(existingProfiles.filter((profile) => profile.email).map((profile) => [profile.email as string, profile]));
    const byTag = new Map(existingProfiles.filter((profile) => profile.equipmentTag).map((profile) => [profile.equipmentTag as string, profile]));

    return items.map((item) => {
      if (item.validationStatus === 'invalid' || !item.phoneE164) {
        return item;
      }

      const duplicateInFile = phoneSeen.has(item.phoneE164);
      phoneSeen.add(item.phoneE164);
      const phoneMatch = byPhone.get(item.phoneE164);
      const emailMatch = item.email ? byEmail.get(item.email) : undefined;
      const tagMatch = item.equipmentTag ? byTag.get(item.equipmentTag) : undefined;
      const conflicting = [emailMatch, tagMatch].some((profile) => profile && profile.phoneE164 !== item.phoneE164);

      if (duplicateInFile || conflicting) {
        return {
          ...item,
          dedupStatus: 'conflict',
          actionPlanned: 'manual_review',
        };
      }

      if (phoneMatch) {
        return {
          ...item,
          dedupStatus: 'duplicate',
          actionPlanned: 'update_profile',
        };
      }

      return item;
    });
  }

  private async applyItem(item: ContactImportItemRecord): Promise<void> {
    if (item.validationStatus !== 'valid' || item.actionPlanned === 'manual_review' || !item.phoneE164) {
      await this.repository.markItemApplied(item.itemId, { actionApplied: 'skipped' });
      return;
    }

    const result = await this.repository.applyProfile({
      phoneE164: item.phoneE164,
      email: item.email,
      contactName: item.contactName,
      companyName: item.companyName,
      equipmentTag: item.equipmentTag,
      equipmentTagUnknown: item.equipmentTagUnknown,
    });
    await this.repository.markItemApplied(item.itemId, {
      actionApplied: result.actionApplied,
      targetContactProfileId: result.targetContactProfileId,
      previousStateJson: result.previousStateJson,
    });
  }

  private async requireBatch(batchId: string): Promise<ContactImportBatchRecord> {
    const batch = await this.repository.findBatch(batchId.trim());
    if (!batch) {
      throw new ContactAgendaImportError('BATCH_NOT_FOUND', 'Batch de importação não encontrado.', 404);
    }

    return batch;
  }

  private async audit(eventType: string, status: 'success' | 'failed', payload: Record<string, unknown>): Promise<void> {
    await this.auditService?.recordAuditEventSafe({
      eventType,
      status,
      severity: status === 'failed' ? 'error' : 'info',
      source: 'ContactAgendaImportService',
      payload,
    });
  }
}
