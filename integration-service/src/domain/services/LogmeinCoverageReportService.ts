/**
 * LogmeinCoverageReportService — F2B_5
 *
 * Conciliation/coverage: three read-only listings showing gaps in the
 * LogMeIn ↔ GLPI mapping.
 *
 *   1. Hosts without entity mapping  (glpi_entity_candidate_id IS NULL)
 *   2. Groups without entity mapping (no active row in group_maps)
 *   3. Hosts without equipment tag   (equipment_tag IS NULL OR '')
 *
 * Safety invariants:
 *   - Read-only: zero mutation.
 *   - No PII: hostName is sanitized by ingest; no MAC, IP, user, credential.
 *   - No ticket creation.
 *   - No WhatsApp send.
 *   - No MariaDB (GLPI) access.
 *   - No schema change.
 *   - All queries delegated to PostgresLogmeinReadonlyRepository.
 *
 * Phase: integaglpi_v9_logmein_operations_001 — F2B_5
 */

import type {
  PostgresLogmeinReadonlyRepository,
  CoverageHostEntry,
  CoverageGroupEntry,
  CoveragePage,
} from '../../repositories/postgres/PostgresLogmeinReadonlyRepository.js';

// ── Re-export types so callers only need this module ─────────────────────────

export type { CoverageHostEntry, CoverageGroupEntry, CoveragePage };

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CoverageFilters {
  limit?: number;
  offset?: number;
}

export interface CoverageReport {
  schema_version: string;
  phase: string;
  deliverable: string;
  generated_at: string;
  hostsWithoutEntity: CoveragePage<CoverageHostEntry>;
  groupsWithoutEntity: CoveragePage<CoverageGroupEntry>;
  hostsWithoutTag: CoveragePage<CoverageHostEntry>;
  readonly_note: string;
}

// ── Service ───────────────────────────────────────────────────────────────────

export class LogmeinCoverageReportService {
  public constructor(
    private readonly readonlyRepo: PostgresLogmeinReadonlyRepository,
  ) {}

  /**
   * Build the full coverage report (all three listings in parallel).
   */
  public async buildReport(filters: CoverageFilters = {}): Promise<CoverageReport> {
    const limit = Math.max(1, Math.min(filters.limit ?? 100, 500));
    const offset = Math.max(0, filters.offset ?? 0);

    const [hostsWithoutEntity, groupsWithoutEntity, hostsWithoutTag] = await Promise.all([
      this.readonlyRepo.listHostsWithoutEntity(limit, offset),
      this.readonlyRepo.listGroupsWithoutEntity(limit, offset),
      this.readonlyRepo.listHostsWithoutTag(limit, offset),
    ]);

    return {
      schema_version: '1.0',
      phase: 'integaglpi_v9_logmein_operations_001',
      deliverable: 'F2B_5',
      generated_at: new Date().toISOString(),
      hostsWithoutEntity,
      groupsWithoutEntity,
      hostsWithoutTag,
      readonly_note:
        'Relatório de conciliação read-only. Nenhum ativo, ticket ou registro foi modificado.',
    };
  }

  /**
   * Hosts with no confirmed GLPI entity mapping.
   */
  public async listHostsWithoutEntity(
    limit = 100,
    offset = 0,
  ): Promise<CoveragePage<CoverageHostEntry>> {
    return this.readonlyRepo.listHostsWithoutEntity(
      Math.max(1, Math.min(limit, 500)),
      Math.max(0, offset),
    );
  }

  /**
   * Groups with no active entity mapping.
   */
  public async listGroupsWithoutEntity(
    limit = 100,
    offset = 0,
  ): Promise<CoveragePage<CoverageGroupEntry>> {
    return this.readonlyRepo.listGroupsWithoutEntity(
      Math.max(1, Math.min(limit, 500)),
      Math.max(0, offset),
    );
  }

  /**
   * Hosts with no equipment tag (cannot be correlated to a GLPI computer).
   */
  public async listHostsWithoutTag(
    limit = 100,
    offset = 0,
  ): Promise<CoveragePage<CoverageHostEntry>> {
    return this.readonlyRepo.listHostsWithoutTag(
      Math.max(1, Math.min(limit, 500)),
      Math.max(0, offset),
    );
  }
}
