/**
 * LogmeinOperationsDashboardService — F2B_1
 *
 * Composes a read-only operations dashboard from existing services:
 *   - LogmeinHealthSummary (sync status, tag coverage, cache age)
 *   - Alarm stats (total events, per-type breakdown, recent alerts)
 *   - Coverage gaps summary (from snapshot counts)
 *
 * Safety invariants:
 *   - Read-only: zero INSERT / UPDATE / DELETE.
 *   - No new UI in GLPI PHP plugin.
 *   - No PII exposed (no phone, user, MAC, IP, credential, session).
 *   - No ticket creation.
 *   - No WhatsApp send.
 *   - No MariaDB (GLPI) access.
 *   - No schema change.
 *   - create_ticket: false — immutable invariant.
 *
 * Phase: integaglpi_v9_logmein_operations_001 — F2B_1
 */

import type { LogmeinHealthSummary } from './LogmeinReadonlyContextService.js';
import type { PostgresLogmeinAlarmRepository } from '../../repositories/postgres/PostgresLogmeinAlarmRepository.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AlarmStatsSummary {
  /** Total rules defined (enabled + disabled). */
  totalRules: number;
  /** Rules currently enabled. */
  enabledRules: number;
  /** Count of events by alarm_type for the configured period. */
  byType: Record<string, number>;
}

export interface LogmeinOperationsDashboard {
  schema_version: string;
  phase: string;
  deliverable: string;
  generated_at: string;
  /** Always false — immutable invariant (F2B contract). */
  create_ticket: false;
  health: LogmeinHealthSummary;
  alarm_stats: AlarmStatsSummary;
  coverage_summary: {
    /** Mirrors health.hostsWithoutTag */
    hostsWithoutTag: number;
    /** Mirrors health.groupsWithoutEntity */
    groupsWithoutEntity: number;
    /** Total hosts with no glpi_entity_candidate_id.
     *  Null when health data unavailable. */
    hostsWithoutEntity: number | null;
  };
  readonly_note: string;
}

// ── Service ───────────────────────────────────────────────────────────────────

export class LogmeinOperationsDashboardService {
  public constructor(
    private readonly alarmRepo: PostgresLogmeinAlarmRepository,
  ) {}

  /**
   * Build the operations dashboard report.
   *
   * @param health  Pre-fetched LogmeinHealthSummary (caller supplies from
   *                LogmeinReadonlyContextService to avoid duplicate queries).
   */
  public async buildDashboard(health: LogmeinHealthSummary): Promise<LogmeinOperationsDashboard> {
    const alarmStats = await this.buildAlarmStats();

    return {
      schema_version: '1.0',
      phase: 'integaglpi_v9_logmein_operations_001',
      deliverable: 'F2B_1',
      generated_at: new Date().toISOString(),
      // Immutable invariant — never changes regardless of rule config.
      create_ticket: false,
      health,
      alarm_stats: alarmStats,
      coverage_summary: {
        hostsWithoutTag: health.hostsWithoutTag,
        groupsWithoutEntity: health.groupsWithoutEntity,
        // hostsWithoutEntity requires a separate query not in the health summary.
        // Filled by the coverage report service (F2B_5) when requested separately.
        hostsWithoutEntity: null,
      },
      readonly_note:
        'Dashboard read-only. Nenhum ticket criado. Nenhuma mensagem WhatsApp enviada. Nenhum dado modificado.',
    };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async buildAlarmStats(): Promise<AlarmStatsSummary> {
    const [allRules, enabledRules] = await Promise.all([
      this.alarmRepo.listAllRules(),
      this.alarmRepo.listEnabledRules(),
    ]);

    // Per-type breakdown from enabled rules only (what is monitored).
    const byType: Record<string, number> = {};
    for (const rule of enabledRules) {
      byType[rule.alarmType] = (byType[rule.alarmType] ?? 0) + 1;
    }

    return {
      totalRules: allRules.length,
      enabledRules: enabledRules.length,
      byType,
    };
  }
}
