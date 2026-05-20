export type ContactImportBatchStatus =
  | 'previewed'
  | 'confirmed'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'rolled_back';

export type ContactImportValidationStatus = 'valid' | 'invalid';
export type ContactImportDedupStatus = 'new' | 'duplicate' | 'conflict';
export type ContactImportActionPlanned = 'create_profile' | 'update_profile' | 'manual_review' | 'none';
export type ContactImportActionApplied =
  | 'created_profile'
  | 'updated_profile'
  | 'skipped'
  | 'rolled_back'
  | 'failed'
  | 'none';

export interface ContactImportBatchRecord {
  batchId: string;
  filename: string;
  uploadedBy: number | null;
  status: ContactImportBatchStatus;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  conflictRows: number;
  errorMessageSanitized: string | null;
  createdAt: Date;
  confirmedAt: Date | null;
  completedAt: Date | null;
  rolledBackAt: Date | null;
}

export interface ContactImportItemRecord {
  itemId: number;
  batchId: string;
  rowNumber: number;
  phoneE164: string | null;
  email: string | null;
  contactName: string | null;
  companyName: string | null;
  equipmentTag: string | null;
  equipmentTagUnknown: boolean;
  validationStatus: ContactImportValidationStatus;
  validationErrors: string[];
  dedupStatus: ContactImportDedupStatus;
  actionPlanned: ContactImportActionPlanned;
  actionApplied: ContactImportActionApplied;
  targetContactProfileId: number | null;
  previousStateJson: Record<string, unknown> | null;
  createdAt: Date;
  appliedAt: Date | null;
}

export interface ContactImportItemInput {
  rowNumber: number;
  phoneE164: string | null;
  email: string | null;
  contactName: string | null;
  companyName: string | null;
  equipmentTag: string | null;
  equipmentTagUnknown: boolean;
  validationStatus: ContactImportValidationStatus;
  validationErrors: string[];
  dedupStatus: ContactImportDedupStatus;
  actionPlanned: ContactImportActionPlanned;
}

export interface ExistingContactProfileRecord {
  id: number;
  phoneE164: string;
  email: string | null;
  equipmentTag: string | null;
  profile: Record<string, unknown>;
}

export interface ApplyProfileInput {
  phoneE164: string;
  email: string | null;
  contactName: string | null;
  companyName: string | null;
  equipmentTag: string | null;
  equipmentTagUnknown: boolean;
}

export interface ApplyProfileResult {
  actionApplied: Extract<ContactImportActionApplied, 'created_profile' | 'updated_profile'>;
  targetContactProfileId: number;
  previousStateJson: Record<string, unknown> | null;
}

export interface ContactAgendaImportRepository {
  createBatch(input: {
    batchId: string;
    filename: string;
    uploadedBy: number | null;
    totalRows: number;
    validRows: number;
    invalidRows: number;
    duplicateRows: number;
    conflictRows: number;
  }): Promise<void>;

  insertItems(batchId: string, items: ContactImportItemInput[]): Promise<ContactImportItemRecord[]>;

  findBatch(batchId: string): Promise<ContactImportBatchRecord | null>;

  listItems(batchId: string, options?: { limit?: number }): Promise<ContactImportItemRecord[]>;

  updateBatchStatus(batchId: string, status: ContactImportBatchStatus, errorMessage?: string | null): Promise<void>;

  findExistingProfiles(input: {
    phoneE164Values: string[];
    emailValues: string[];
    equipmentTagValues: string[];
  }): Promise<ExistingContactProfileRecord[]>;

  applyProfile(input: ApplyProfileInput): Promise<ApplyProfileResult>;

  markItemApplied(
    itemId: number,
    input: {
      actionApplied: ContactImportActionApplied;
      targetContactProfileId?: number | null;
      previousStateJson?: Record<string, unknown> | null;
    },
  ): Promise<void>;

  createRollbackRecord(input: {
    batchId: string;
    itemId: number | null;
    reason: string;
    previousStateJson: Record<string, unknown> | null;
    requestedBy: number | null;
    rollbackState: 'completed' | 'failed';
  }): Promise<void>;

  restoreProfileFromPreviousState(profileId: number, previousState: Record<string, unknown>): Promise<void>;

  markCreatedProfileInactive(profileId: number): Promise<void>;
}
