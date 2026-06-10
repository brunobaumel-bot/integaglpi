/**
 * CentralHubAggregatorService — F3 Central Hub Operacional
 *
 * Read-only aggregator for the 5 operational cards of the Central Hub:
 *   - saude_hml    : Service health (Postgres, Redis, Ollama, workers, disk)
 *   - smart_help   : AI Smart Help / Copilot status
 *   - kb_quality   : KB effectiveness metrics (Golden Set, feedback, gaps)
 *   - logmein      : LogMeIn host coverage and sync health
 *   - alarmes      : Recent alarm event breakdown (F2B_2 history)
 *
 * Safety invariants (F3 contract — ABSOLUTE):
 *   - Read-only: zero INSERT / UPDATE / DELETE / ALTER.
 *   - No PII: no phone, MAC, IP, user, token, credential, raw prompt.
 *   - No ticket creation.
 *   - No WhatsApp send.
 *   - No remote LogMeIn session.
 *   - No MariaDB (GLPI) access.
 *   - No schema change.
 *   - No Fase 4 correlation (no incident master, no cross-card deduction).
 *   - Each card has an individual 3 000ms timeout; failures are isolated.
 *   - CENTRAL_HUB_ENABLED=false → snapshot with feature_flag_enabled=false
 *     (cards still aggregated but UI should show "disabled" message).
 *
 * Phase: integaglpi_v9_central_hub_001 — F3_1
 */

import type { Pool } from 'pg';

import type { KbEffectivenessService } from '../../services/KbEffectivenessService.js';
import type { LogmeinReadonlyContextService } from './LogmeinReadonlyContextService.js';
import type { LogmeinOperationsDashboardService } from './LogmeinOperationsDashboardService.js';
import type { PostgresLogmeinAlarmRepository } from '../../repositories/postgres/PostgresLogmeinAlarmRepository.js';
import { logger } from '../../infra/logger/logger.js';
import { redisClient } from '../../cache/redisClient.js';
import { env } from '../../config/env.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const CARD_TIMEOUT_MS = 3_000;
const ALARM_HISTORY_PERIOD_DAYS = 7;
const ALARM_HISTORY_LIMIT = 200;
const REDIS_CACHE_KEY = 'integaglpi:central_hub:snapshot';
const REDIS_CACHE_TTL_SECONDS = 60;

// ── Card types ─────────────────────────────────────────────────────────────────

export interface HubCardSaude {
  postgres_ok: boolean;
  postgres_latency_ms: number | null;
  redis_ok: boolean;
  redis_status: string;
  ollama_configured: boolean;
  ollama_provider: string;
  uptime_seconds: number;
  workers_ai_enabled: boolean;
  meta_configured: boolean;
  glpi_configured: boolean;
}

export interface HubCardSmartHelp {
  ai_supervisor_enabled: boolean;
  ai_supervisor_provider: string;
  ai_supervisor_model: string | null;
  copilot_enabled: boolean;
  copilot_provider: string;
  cloud_enabled: boolean;
  pii_guard_note: string;
}

export interface HubCardKbQuality {
  golden_set_total_queries: number;
  product_detection_rate_baseline: number | null;
  tier_coverage_rate_baseline: number | null;
  total_votes_period: number;
  overall_helpful_ratio: number | null;
  articles_with_votes: number;
  top_gap_categories: string[];
  period_days: number;
}

export interface HubCardLogmein {
  total_hosts: number;
  hosts_without_tag: number;
  groups_without_entity: number;
  hosts_without_entity_note: string;
  last_sync_status: string | null;
  last_sync_at: string | null;
  cache_age_hours: number | null;
  enabled_rules: number;
  alarm_types_monitored: string[];
}

export interface HubCardAlarmes {
  period_days: number;
  total_events: number;
  by_result_type: {
    fired: number;
    suppressed_cooldown: number;
    suppressed_dedupe: number;
    ticket_created: number;
    dry_run: number;
  };
  recent_alarm_types: string[];
}

export interface HubCard<T> {
  ok: boolean;
  data: T | null;
  error: string | null;
  latency_ms: number;
}

export interface CentralHubSnapshot {
  schema_version: string;
  phase: string;
  generated_at: string;
  feature_flag_enabled: boolean;
  cards: {
    saude_hml: HubCard<HubCardSaude>;
    smart_help: HubCard<HubCardSmartHelp>;
    kb_quality: HubCard<HubCardKbQuality>;
    logmein: HubCard<HubCardLogmein>;
    alarmes: HubCard<HubCardAlarmes>;
  };
  readonly_note: string;
  create_ticket: false;
}

// ── Service deps ──────────────────────────────────────────────────────────────

export interface CentralHubDeps {
  pool: Pool;
  kbEffectivenessService: KbEffectivenessService;
  logmeinContextService: LogmeinReadonlyContextService;
  logmeinDashboardService: LogmeinOperationsDashboardService;
  alarmRepository: PostgresLogmeinAlarmRepository;
}

// ── Helper ────────────────────────────────────────────────────────────────────

async function withCardTimeout<T>(
  name: string,
  fn: () => Promise<T>,
): Promise<HubCard<T>> {
  const t0 = Date.now();
  try {
    const data = await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`card_timeout:${name}`)), CARD_TIMEOUT_MS);
      }),
    ]);
    return { ok: true, data, error: null, latency_ms: Date.now() - t0 };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ card: name, error_message: msg }, '[central_hub] card failed');
    return { ok: false, data: null, error: msg, latency_ms: Date.now() - t0 };
  }
}

// ── Service ───────────────────────────────────────────────────────────────────

export class CentralHubAggregatorService {
  public constructor(private readonly deps: CentralHubDeps) {}

  /**
   * Build the full Central Hub snapshot.
   * Uses Redis cache (TTL 60s) when available.
   */
  public async buildSnapshot(): Promise<CentralHubSnapshot> {
    // Try Redis cache first.
    try {
      const cached = await redisClient.get(REDIS_CACHE_KEY);
      if (cached != null) {
        const parsed = JSON.parse(cached) as CentralHubSnapshot;
        return parsed;
      }
    } catch {
      // Cache miss or Redis unavailable — continue without cache.
    }

    const snapshot = await this.aggregate();

    // Write to Redis cache (non-blocking, fire-and-forget).
    redisClient.set(REDIS_CACHE_KEY, JSON.stringify(snapshot), 'EX', REDIS_CACHE_TTL_SECONDS).catch(() => {
      /* cache write failure is silent */
    });

    return snapshot;
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private async aggregate(): Promise<CentralHubSnapshot> {
    const featureFlagEnabled = env.CENTRAL_HUB_ENABLED;

    // All cards run in parallel with individual timeouts.
    const [saude, smartHelp, kbQuality, logmein, alarmes] = await Promise.all([
      withCardTimeout('saude_hml', () => this.buildSaudeCard()),
      withCardTimeout('smart_help', () => this.buildSmartHelpCard()),
      withCardTimeout('kb_quality', () => this.buildKbQualityCard()),
      withCardTimeout('logmein', () => this.buildLogmeinCard()),
      withCardTimeout('alarmes', () => this.buildAlarmesCard()),
    ]);

    return {
      schema_version: '1.0',
      phase: 'integaglpi_v9_central_hub_001',
      generated_at: new Date().toISOString(),
      feature_flag_enabled: featureFlagEnabled,
      cards: {
        saude_hml: saude,
        smart_help: smartHelp,
        kb_quality: kbQuality,
        logmein: logmein,
        alarmes: alarmes,
      },
      readonly_note:
        'Hub read-only. Nenhum ticket criado. Nenhuma mensagem WhatsApp enviada. Nenhum dado modificado.',
      create_ticket: false,
    };
  }

  // ── Card builders ─────────────────────────────────────────────────────────

  private async buildSaudeCard(): Promise<HubCardSaude> {
    const t0 = Date.now();
    let postgresOk = false;
    let postgresLatencyMs: number | null = null;

    try {
      await Promise.race([
        this.deps.pool.query('SELECT 1'),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('pg_timeout')), 2_000);
        }),
      ]);
      postgresOk = true;
      postgresLatencyMs = Date.now() - t0;
    } catch {
      postgresOk = false;
    }

    const redisOk = redisClient.status === 'ready';
    const metaConfigured = Boolean(env.META_APP_SECRET && env.META_ACCESS_TOKEN && env.META_VERIFY_TOKEN);
    const glpiConfigured = Boolean(env.GLPI_API_BASE_URL && env.GLPI_APP_TOKEN && env.GLPI_USER_TOKEN);

    return {
      postgres_ok: postgresOk,
      postgres_latency_ms: postgresLatencyMs,
      redis_ok: redisOk,
      redis_status: redisClient.status,
      ollama_configured: env.AI_SUPERVISOR_BASE_URL.trim() !== '',
      ollama_provider: env.AI_SUPERVISOR_PROVIDER ?? 'disabled',
      uptime_seconds: Math.floor(process.uptime()),
      workers_ai_enabled: env.AI_ONLINE_ALERT_WORKER_LOOP === true,
      meta_configured: metaConfigured,
      glpi_configured: glpiConfigured,
    };
  }

  private async buildSmartHelpCard(): Promise<HubCardSmartHelp> {
    // Read from DB ai_settings context (same pattern as diagnostics endpoint).
    let supervisorEnabled = env.AI_SUPERVISOR_ENABLED;
    let supervisorProvider: string = env.AI_SUPERVISOR_PROVIDER ?? 'disabled';
    let supervisorModel: string | null = env.AI_SUPERVISOR_MODEL ?? null;
    let copilotEnabled = env.AI_SUPERVISOR_ENABLED;
    let copilotProvider: string = env.AI_SUPERVISOR_PROVIDER ?? 'disabled';
    const cloudEnabled = false; // Always false per safety invariant

    try {
      const rows = await this.deps.pool.query<{ key: string; value: string }>(
        `
          SELECT key, value::text AS value
          FROM (
            SELECT 'ai_supervisor_enabled'  AS key, ai_supervisor_enabled::text  AS value FROM glpi_plugin_integaglpi_configs WHERE context = 'ai_settings'
            UNION ALL
            SELECT 'ai_supervisor_provider' AS key, ai_supervisor_provider::text  AS value FROM glpi_plugin_integaglpi_configs WHERE context = 'ai_settings'
            UNION ALL
            SELECT 'ai_supervisor_model'    AS key, ai_supervisor_model::text     AS value FROM glpi_plugin_integaglpi_configs WHERE context = 'ai_settings'
            UNION ALL
            SELECT 'copilot_enabled'        AS key, copilot_enabled::text         AS value FROM glpi_plugin_integaglpi_configs WHERE context = 'ai_settings'
            UNION ALL
            SELECT 'copilot_provider'       AS key, copilot_provider::text        AS value FROM glpi_plugin_integaglpi_configs WHERE context = 'ai_settings'
          ) t
          WHERE value IS NOT NULL AND value <> ''
        `,
      );
      const settings = new Map(rows.rows.map((r) => [r.key, r.value]));
      const boolValue = (key: string, fallback: boolean): boolean => {
        const v = String(settings.get(key) ?? '').toLowerCase();
        if (['1', 'true', 'yes', 'on'].includes(v)) return true;
        if (['0', 'false', 'no', 'off'].includes(v)) return false;
        return fallback;
      };
      const strValue = (key: string, fallback: string): string => {
        const v = String(settings.get(key) ?? '').trim().slice(0, 120);
        return v !== '' ? v : fallback;
      };

      supervisorEnabled = boolValue('ai_supervisor_enabled', supervisorEnabled);
      supervisorProvider = strValue('ai_supervisor_provider', supervisorProvider);
      supervisorModel = strValue('ai_supervisor_model', supervisorModel ?? '');
      copilotEnabled = boolValue('copilot_enabled', supervisorEnabled);
      copilotProvider = strValue('copilot_provider', supervisorProvider);
    } catch {
      // DB unavailable — use env fallback (already set above).
    }

    return {
      ai_supervisor_enabled: supervisorEnabled,
      ai_supervisor_provider: supervisorProvider,
      ai_supervisor_model: supervisorModel !== '' ? supervisorModel : null,
      copilot_enabled: copilotEnabled,
      copilot_provider: copilotProvider,
      cloud_enabled: cloudEnabled,
      pii_guard_note: 'PII Guard ativo — dados de cliente nunca enviados ao Hub.',
    };
  }

  private async buildKbQualityCard(): Promise<HubCardKbQuality> {
    const report = await this.deps.kbEffectivenessService.buildReport({ periodDays: 30 });

    // Read baseline.json for product_detection_rate / tier_coverage_rate.
    let baselineProductDetection: number | null = null;
    let baselineTierCoverage: number | null = null;
    try {
      const { readFileSync } = await import('node:fs');
      const { join, dirname } = await import('node:path');
      const { fileURLToPath } = await import('node:url');
      const dir = dirname(fileURLToPath(import.meta.url));
      const baselinePath = join(dir, '../../../../docs/eval_reports/baseline.json');
      const raw = readFileSync(baselinePath, 'utf8');
      const baseline = JSON.parse(raw) as { metrics?: { product_detection_rate?: number; tier_coverage_rate?: number } };
      baselineProductDetection = baseline.metrics?.product_detection_rate ?? null;
      baselineTierCoverage = baseline.metrics?.tier_coverage_rate ?? null;
    } catch {
      // Baseline not available — null is safe.
    }

    const topGaps = report.gap_analysis.slice(0, 3).map((g) => g.category);

    return {
      golden_set_total_queries: report.golden_set_meta.total_queries,
      product_detection_rate_baseline: baselineProductDetection,
      tier_coverage_rate_baseline: baselineTierCoverage,
      total_votes_period: report.feedback_health.totalVotes,
      overall_helpful_ratio: report.feedback_health.overallHelpfulRatio,
      articles_with_votes: report.feedback_health.articlesWithVotes,
      top_gap_categories: topGaps,
      period_days: report.period_days,
    };
  }

  private async buildLogmeinCard(): Promise<HubCardLogmein> {
    const health = await this.deps.logmeinContextService.getHealthSummary();
    const dashboard = await this.deps.logmeinDashboardService.buildDashboard(health);

    return {
      total_hosts: health.totalHosts,
      hosts_without_tag: health.hostsWithoutTag,
      groups_without_entity: health.groupsWithoutEntity,
      hosts_without_entity_note:
        'Ver relatório de conciliação para lista detalhada (hostsWithoutEntity não calculado aqui).',
      last_sync_status: health.lastSyncStatus ?? null,
      last_sync_at: health.lastSyncTimestamp ?? null,
      cache_age_hours: health.cacheAgeHours,
      enabled_rules: dashboard.alarm_stats.enabledRules,
      alarm_types_monitored: Object.keys(dashboard.alarm_stats.byType),
    };
  }

  private async buildAlarmesCard(): Promise<HubCardAlarmes> {
    const page = await this.deps.alarmRepository.listAlarmHistory({
      periodDays: ALARM_HISTORY_PERIOD_DAYS,
      limit: ALARM_HISTORY_LIMIT,
      offset: 0,
    });

    const byType: HubCardAlarmes['by_result_type'] = {
      fired: 0,
      suppressed_cooldown: 0,
      suppressed_dedupe: 0,
      ticket_created: 0,
      dry_run: 0,
    };

    const alarmTypes = new Set<string>();
    for (const entry of page.entries) {
      byType[entry.resultType] = (byType[entry.resultType] ?? 0) + 1;
      alarmTypes.add(entry.alarmType);
    }

    return {
      period_days: ALARM_HISTORY_PERIOD_DAYS,
      total_events: page.total,
      by_result_type: byType,
      recent_alarm_types: [...alarmTypes].slice(0, 5),
    };
  }
}
