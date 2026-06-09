/**
 * LogmeinAlarmCorrelationService — F4 Alarm Correlation
 *
 * Deterministic, in-memory grouping of alarm events by alarm_type + time window.
 * Groups are classified by severity based on event count and host spread.
 * No LLM in the critical path.
 *
 * Safety invariants (F4 contract — ABSOLUTE):
 *   - Read-only: zero INSERT / UPDATE / DELETE / ALTER.
 *   - No PII: alarm_type is an enum-like string; hostname is sanitized by ingest.
 *   - No ticket creation.
 *   - No WhatsApp send.
 *   - No remote LogMeIn session.
 *   - No MariaDB (GLPI) access.
 *   - No schema change.
 *   - No LLM: all severity and reason text is deterministic.
 *   - ALARM_CORRELATION_ENABLED=false → returns empty groups with disabled flag.
 *
 * Phase: integaglpi_v9_alarm_correlation_001 — F4
 */

import type {
  PostgresLogmeinAlarmRepository,
  CorrelationAggregate,
} from '../../repositories/postgres/PostgresLogmeinAlarmRepository.js';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Default look-back window for correlation analysis. */
const DEFAULT_WINDOW_MINUTES = 60;
/** Default maximum number of correlation groups to return. */
const DEFAULT_LIMIT = 20;

// ── Types ─────────────────────────────────────────────────────────────────────

export type CorrelationSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface CorrelationGroup {
  alarmType: string;
  totalEvents: number;
  distinctHosts: number;
  windowMinutes: number;
  firstEvent: string; // ISO-8601
  lastEvent: string;  // ISO-8601
  durationMinutes: number;
  severity: CorrelationSeverity;
  /** Human-readable explanation (deterministic — no LLM). */
  reason: string;
  /** Suppressed events ratio within the group. */
  suppressedRatio: number | null;
  ticketsCreated: number;
}

export interface CorrelationReport {
  schema_version: string;
  phase: string;
  feature_flag_enabled: boolean;
  generated_at: string;
  window_minutes: number;
  total_groups: number;
  /** Groups sorted by severity DESC, then totalEvents DESC. */
  groups: CorrelationGroup[];
  /** Always false — immutable invariant. */
  create_ticket: false;
  /** Always false — advisory only. */
  real_execution_forbidden: true;
  readonly_note: string;
}

// ── Severity derivation ───────────────────────────────────────────────────────

/**
 * Classify severity based on event count and host spread.
 * Rules are deterministic and ordered by priority.
 *
 *   critical  : totalEvents >= 10 AND distinctHosts >= 3
 *   high      : totalEvents >= 5  OR  distinctHosts >= 3
 *   medium    : totalEvents >= 2  OR  distinctHosts >= 2
 *   low       : default
 */
export function deriveSeverity(agg: CorrelationAggregate): CorrelationSeverity {
  if (agg.totalEvents >= 10 && agg.distinctHosts >= 3) return 'critical';
  if (agg.totalEvents >= 5 || agg.distinctHosts >= 3) return 'high';
  if (agg.totalEvents >= 2 || agg.distinctHosts >= 2) return 'medium';
  return 'low';
}

/**
 * Produce a deterministic, non-PII reason string from the aggregate.
 */
export function deriveCorrelationReason(
  agg: CorrelationAggregate,
  severity: CorrelationSeverity,
): string {
  const suppressed = agg.cooldownSkippedCount + agg.dedupeHitCount;
  const suppressedPct =
    agg.totalEvents > 0
      ? Math.round((suppressed / agg.totalEvents) * 100)
      : 0;
  const ticketPart =
    agg.ticketCreatedCount > 0
      ? ` ${agg.ticketCreatedCount} ticket(s) criado(s).`
      : '';
  const suppressedPart =
    suppressed > 0 ? ` ${suppressedPct}% suprimidos (cooldown/dedupe).` : '';

  switch (severity) {
    case 'critical':
      return (
        `Concentração crítica: ${agg.totalEvents} eventos de "${agg.alarmType}"` +
        ` em ${agg.distinctHosts} hosts distintos.${suppressedPart}${ticketPart}`
      );
    case 'high':
      return (
        `Volume alto: ${agg.totalEvents} eventos de "${agg.alarmType}"` +
        ` (${agg.distinctHosts} host(s)).${suppressedPart}${ticketPart}`
      );
    case 'medium':
      return (
        `Agrupamento moderado: ${agg.totalEvents} eventos de "${agg.alarmType}".` +
        `${suppressedPart}${ticketPart}`
      );
    default:
      return `${agg.totalEvents} evento(s) de "${agg.alarmType}" na janela.${ticketPart}`;
  }
}

// ── Service ───────────────────────────────────────────────────────────────────

export class LogmeinAlarmCorrelationService {
  public constructor(
    private readonly alarmRepository: PostgresLogmeinAlarmRepository,
  ) {}

  /**
   * Build correlation report for the given time window.
   *
   * @param windowMinutes  Look-back window in minutes [1..10080]. Default 60.
   * @param limit          Max groups to return [1..100]. Default 20.
   */
  public async buildReport(
    windowMinutes = DEFAULT_WINDOW_MINUTES,
    limit = DEFAULT_LIMIT,
  ): Promise<CorrelationReport> {
    const featureFlagEnabled =
      String(process.env['ALARM_CORRELATION_ENABLED'] ?? '').toLowerCase() === 'true';

    const safeWindow = Math.max(1, Math.min(windowMinutes, 10_080));
    const safeLimit = Math.max(1, Math.min(limit, 100));

    const aggregates = await this.alarmRepository.listCorrelationAggregates(
      safeWindow,
      safeLimit,
    );

    const groups = this.classifyAggregates(aggregates, safeWindow);

    return {
      schema_version: '1.0',
      phase: 'integaglpi_v9_alarm_correlation_001',
      feature_flag_enabled: featureFlagEnabled,
      generated_at: new Date().toISOString(),
      window_minutes: safeWindow,
      total_groups: groups.length,
      groups,
      create_ticket: false,
      real_execution_forbidden: true,
      readonly_note:
        'Correlação read-only. Nenhum ticket criado. Nenhum alarme modificado. Nenhum comando executado.',
    };
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private classifyAggregates(
    aggregates: CorrelationAggregate[],
    windowMinutes: number,
  ): CorrelationGroup[] {
    const groups: CorrelationGroup[] = aggregates.map((agg) => {
      const severity = deriveSeverity(agg);
      const reason = deriveCorrelationReason(agg, severity);
      const suppressed = agg.cooldownSkippedCount + agg.dedupeHitCount;
      const suppressedRatio =
        agg.totalEvents > 0 ? suppressed / agg.totalEvents : null;

      const firstMs = agg.firstEvent.getTime();
      const lastMs = agg.lastEvent.getTime();
      const durationMinutes = Math.max(
        0,
        Math.round((lastMs - firstMs) / 60_000),
      );

      return {
        alarmType: agg.alarmType,
        totalEvents: agg.totalEvents,
        distinctHosts: agg.distinctHosts,
        windowMinutes,
        firstEvent: agg.firstEvent.toISOString(),
        lastEvent: agg.lastEvent.toISOString(),
        durationMinutes,
        severity,
        reason,
        suppressedRatio,
        ticketsCreated: agg.ticketCreatedCount,
      };
    });

    // Sort: critical > high > medium > low, then totalEvents DESC.
    const SEVERITY_ORDER: Record<CorrelationSeverity, number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
    };
    groups.sort((a, b) => {
      const diff = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
      if (diff !== 0) return diff;
      return b.totalEvents - a.totalEvents;
    });

    return groups;
  }
}
