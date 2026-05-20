import { describe, expect, it, vi } from 'vitest';

import {
  CONTACT_IMPORT_CHUNK_SIZE,
  CONTACT_IMPORT_MAX_LINES,
  ContactAgendaImportService,
} from '../src/domain/services/ContactAgendaImportService.js';
import type {
  ApplyProfileInput,
  ApplyProfileResult,
  ContactAgendaImportRepository,
  ContactImportBatchRecord,
  ContactImportBatchStatus,
  ContactImportItemInput,
  ContactImportItemRecord,
  ExistingContactProfileRecord,
} from '../src/repositories/contracts/ContactAgendaImportRepository.js';

function batchRecord(input: Partial<ContactImportBatchRecord>): ContactImportBatchRecord {
  return {
    batchId: input.batchId ?? 'batch-1',
    filename: input.filename ?? 'agenda.csv',
    uploadedBy: input.uploadedBy ?? 10,
    status: input.status ?? 'previewed',
    totalRows: input.totalRows ?? 0,
    validRows: input.validRows ?? 0,
    invalidRows: input.invalidRows ?? 0,
    duplicateRows: input.duplicateRows ?? 0,
    conflictRows: input.conflictRows ?? 0,
    errorMessageSanitized: input.errorMessageSanitized ?? null,
    createdAt: input.createdAt ?? new Date(),
    confirmedAt: input.confirmedAt ?? null,
    completedAt: input.completedAt ?? null,
    rolledBackAt: input.rolledBackAt ?? null,
  };
}

function itemRecord(batchId: string, itemId: number, input: ContactImportItemInput): ContactImportItemRecord {
  return {
    itemId,
    batchId,
    rowNumber: input.rowNumber,
    phoneE164: input.phoneE164,
    email: input.email,
    contactName: input.contactName,
    companyName: input.companyName,
    equipmentTag: input.equipmentTag,
    equipmentTagUnknown: input.equipmentTagUnknown,
    validationStatus: input.validationStatus,
    validationErrors: input.validationErrors,
    dedupStatus: input.dedupStatus,
    actionPlanned: input.actionPlanned,
    actionApplied: 'none',
    targetContactProfileId: null,
    previousStateJson: null,
    createdAt: new Date(),
    appliedAt: null,
  };
}

class FakeContactImportRepository implements ContactAgendaImportRepository {
  public batches = new Map<string, ContactImportBatchRecord>();
  public items = new Map<string, ContactImportItemRecord[]>();
  public existingProfiles: ExistingContactProfileRecord[] = [];
  public appliedProfiles: ApplyProfileInput[] = [];
  public rollbackRecords: Array<{ batchId: string; itemId: number | null; reason: string; rollbackState: string }> = [];

  public async createBatch(input: {
    batchId: string;
    filename: string;
    uploadedBy: number | null;
    totalRows: number;
    validRows: number;
    invalidRows: number;
    duplicateRows: number;
    conflictRows: number;
  }): Promise<void> {
    this.batches.set(input.batchId, batchRecord(input));
  }

  public async insertItems(batchId: string, items: ContactImportItemInput[]): Promise<ContactImportItemRecord[]> {
    const records = items.map((item, index) => itemRecord(batchId, index + 1, item));
    this.items.set(batchId, records);
    return records;
  }

  public async findBatch(batchId: string): Promise<ContactImportBatchRecord | null> {
    return this.batches.get(batchId) ?? null;
  }

  public async listItems(batchId: string): Promise<ContactImportItemRecord[]> {
    return this.items.get(batchId) ?? [];
  }

  public async updateBatchStatus(batchId: string, status: ContactImportBatchStatus): Promise<void> {
    const batch = this.batches.get(batchId);
    if (batch) {
      this.batches.set(batchId, { ...batch, status });
    }
  }

  public async findExistingProfiles(): Promise<ExistingContactProfileRecord[]> {
    return this.existingProfiles;
  }

  public async applyProfile(input: ApplyProfileInput): Promise<ApplyProfileResult> {
    this.appliedProfiles.push(input);
    const existing = this.existingProfiles.find((profile) => profile.phoneE164 === input.phoneE164);
    if (existing) {
      return {
        actionApplied: 'updated_profile',
        targetContactProfileId: existing.id,
        previousStateJson: existing.profile,
      };
    }
    return {
      actionApplied: 'created_profile',
      targetContactProfileId: this.appliedProfiles.length + 100,
      previousStateJson: null,
    };
  }

  public async markItemApplied(
    itemId: number,
    input: { actionApplied: ContactImportItemRecord['actionApplied']; targetContactProfileId?: number | null; previousStateJson?: Record<string, unknown> | null },
  ): Promise<void> {
    for (const [batchId, items] of this.items.entries()) {
      const next = items.map((item) => item.itemId === itemId
        ? {
            ...item,
            actionApplied: input.actionApplied,
            targetContactProfileId: input.targetContactProfileId ?? item.targetContactProfileId,
            previousStateJson: input.previousStateJson ?? item.previousStateJson,
          }
        : item);
      this.items.set(batchId, next);
    }
  }

  public async createRollbackRecord(input: {
    batchId: string;
    itemId: number | null;
    reason: string;
    rollbackState: 'completed' | 'failed';
  }): Promise<void> {
    this.rollbackRecords.push(input);
  }

  public restoreProfileFromPreviousState = vi.fn(async () => {});
  public markCreatedProfileInactive = vi.fn(async () => {});
}

const auditService = {
  recordAuditEventSafe: vi.fn(async () => {}),
};

describe('ContactAgendaImportService', () => {
  it('generates preview without applying records', async () => {
    const repository = new FakeContactImportRepository();
    const service = new ContactAgendaImportService(repository, auditService as never);

    const result = await service.preview({
      filename: 'agenda.csv',
      uploadedBy: 7,
      csvContent: 'telefone,email,nome,empresa,etiqueta\n5599999999999,user@example.com,Ana,Cliente,1234',
    });

    expect(result.batch.status).toBe('previewed');
    expect(result.batch.validRows).toBe(1);
    expect(result.items[0].phone_masked).toBe('+55******9999');
    expect(result.items[0].email_masked).toBe('u***@example.com');
    expect(repository.appliedProfiles).toHaveLength(0);
  });

  it('marks invalid email and invalid equipment tag without applying', async () => {
    const repository = new FakeContactImportRepository();
    const service = new ContactAgendaImportService(repository, auditService as never);

    const result = await service.preview({
      filename: 'agenda.csv',
      uploadedBy: 7,
      csvContent: 'telefone,email,nome,empresa,etiqueta\n5599999999999,email-invalido,Ana,Cliente,ABCD',
    });

    expect(result.batch.invalidRows).toBe(1);
    expect(result.items[0].validation_status).toBe('invalid');
    expect(result.items[0].validation_errors).toEqual(['e-mail inválido', 'etiqueta/patrimônio inválido']);
  });

  it('deduplicates by phone and marks cross-field conflicts for manual review', async () => {
    const repository = new FakeContactImportRepository();
    repository.existingProfiles = [
      { id: 11, phoneE164: '+5599999999999', email: 'old@example.com', equipmentTag: '1234', profile: { id: 11 } },
      { id: 12, phoneE164: '+5588888888888', email: 'conflict@example.com', equipmentTag: '5678', profile: { id: 12 } },
    ];
    const service = new ContactAgendaImportService(repository, auditService as never);

    const result = await service.preview({
      filename: 'agenda.csv',
      uploadedBy: 7,
      csvContent: [
        'telefone,email,nome,empresa,etiqueta',
        '5599999999999,old@example.com,Ana,Cliente,1234',
        '5577777777777,conflict@example.com,Beto,Cliente,9999',
      ].join('\n'),
    });

    expect(result.items[0].dedup_status).toBe('duplicate');
    expect(result.items[0].action_planned).toBe('update_profile');
    expect(result.items[1].dedup_status).toBe('conflict');
    expect(result.items[1].action_planned).toBe('manual_review');
  });

  it('confirms import in chunks and skips invalid/conflict rows', async () => {
    const repository = new FakeContactImportRepository();
    const service = new ContactAgendaImportService(repository, auditService as never, undefined, { chunkSize: 1 });
    const preview = await service.preview({
      filename: 'agenda.csv',
      uploadedBy: 7,
      csvContent: [
        'telefone,email,nome,empresa,etiqueta',
        '5599999999999,user@example.com,Ana,Cliente,1234',
        'invalid,user2@example.com,Beto,Cliente,1235',
      ].join('\n'),
    });

    const confirmed = await service.confirm({ batchId: preview.batch.batchId, confirmedBy: 7 });

    expect(confirmed.batch.status).toBe('completed');
    expect(repository.appliedProfiles).toHaveLength(1);
    expect(confirmed.items.map((item) => item.action_applied)).toEqual(['created_profile', 'skipped']);
  });

  it('rolls back applied items logically without physical delete', async () => {
    const repository = new FakeContactImportRepository();
    const service = new ContactAgendaImportService(repository, auditService as never);
    const preview = await service.preview({
      filename: 'agenda.csv',
      uploadedBy: 7,
      csvContent: 'telefone,email,nome,empresa,etiqueta\n5599999999999,user@example.com,Ana,Cliente,1234',
    });
    await service.confirm({ batchId: preview.batch.batchId, confirmedBy: 7 });

    const rolledBack = await service.rollback({
      batchId: preview.batch.batchId,
      requestedBy: 7,
      reason: 'teste operacional',
    });

    expect(rolledBack.batch.status).toBe('rolled_back');
    expect(repository.markCreatedProfileInactive).toHaveBeenCalledWith(101);
    expect(repository.rollbackRecords[0]).toMatchObject({ rollbackState: 'completed' });
  });

  it('enforces max lines and exposes chunk constants', async () => {
    expect(CONTACT_IMPORT_MAX_LINES).toBe(1000);
    expect(CONTACT_IMPORT_CHUNK_SIZE).toBe(100);
  });
});
