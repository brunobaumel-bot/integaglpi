import { createHash } from 'node:crypto';
import type { QueryResultRow } from 'pg';

import type { SqlExecutor } from '../infra/db/postgres.js';

export interface QualityDashboardCache {
  get(key: string): Promise<string | null>;
  setex(key: string, ttlSeconds: number, value: string): Promise<unknown>;
}

export interface QualityDashboardFilters {
  dateFrom: string;
  dateTo: string;
  entityIds: number[];
  queueId?: number;
  technicianId?: number;
  status?: string;
  csat?: string;
  sla?: string;
  deliveryStatus?: string;
  inactivity?: string;
  page: number;
  limit: number;
}

type DashboardRow = Record<string, unknown>;

const MAX_DAYS = 30;
const CACHE_TTL_SECONDS = 600;

export class QualityDashboardError extends Error {
  public constructor(
    public readonly statusCode: number,
    public readonly errorCode: string,
    message: string,
  ) {
    super(message);
  }
}

export class QualityDashboardService {
  public constructor(
    private readonly executor: SqlExecutor,
    private readonly cache: QualityDashboardCache,
  ) {}

  public async getDashboard(rawFilters: QualityDashboardFilters): Promise<Record<string, unknown>> {
    const filters = normalizeFilters(rawFilters);
    const cacheKey = this.buildCacheKey(filters);
    const cached = await this.readCache(cacheKey);
    if (cached !== null) {
      return { ...cached, cache_status: 'hit' };
    }

    const params = buildBaseParams(filters);
    const [kpis, delivery, inactivity, csat, aiFlags, aiFeedback, contracts, rows, total] = await Promise.all([
      this.queryKpis(filters, params),
      this.queryDelivery(filters, params),
      this.queryInactivity(filters, params),
      this.queryCsat(filters, params),
      this.queryAiFlags(filters, params),
      this.queryAiFeedback(filters, params),
      this.queryContracts(filters),
      this.queryRows(filters, params),
      this.queryRowTotal(filters, params),
    ]);

    const result = {
      ok: true,
      filters: serializeFilters(filters),
      kpis: {
        ...kpis,
        messages_sent: Number(delivery.total_outbound ?? 0),
        messages_delivered: Number(delivery.delivered ?? 0),
        messages_read: Number(delivery.read ?? 0),
        messages_failed: Number(delivery.failed ?? 0),
        inactivity_reminders_sent: Number(inactivity.reminders_sent ?? 0),
        inactivity_autoclose_done: Number(inactivity.autoclose_done ?? 0),
        contracts_hours_alerts: Number(contracts.alerts ?? 0),
        csat_average: csat.average,
      },
      breakdowns: {
        csat: csat.rows,
        delivery_status: delivery.rows,
        meta_failures: delivery.failures,
        inactivity: inactivity.rows,
        inactivity_skips: inactivity.skips,
        ai_flags: aiFlags,
        ai_feedback: aiFeedback,
        contracts_hours: contracts.rows,
      },
      pagination: {
        page: filters.page,
        limit: filters.limit,
        total,
        total_pages: Math.max(1, Math.ceil(total / filters.limit)),
      },
      rows,
      cache_status: 'miss',
    };

    await this.writeCache(cacheKey, result);

    return result;
  }

  private async queryKpis(filters: NormalizedFilters, params: unknown[]): Promise<Record<string, unknown>> {
    const result = await this.executor.query(
      `
        WITH base AS (${baseConversationSql(filters)})
        SELECT
          COUNT(*)::int AS total_conversations,
          COUNT(DISTINCT glpi_ticket_id) FILTER (WHERE glpi_ticket_id > 0)::int AS total_tickets_created,
          COUNT(DISTINCT glpi_ticket_id) FILTER (WHERE glpi_ticket_id > 0 AND conversation_status = 'open')::int AS tickets_open,
          COUNT(DISTINCT glpi_ticket_id) FILTER (WHERE final_ticket_status = 5)::int AS tickets_solved,
          COUNT(DISTINCT glpi_ticket_id) FILTER (WHERE final_ticket_status = 6 OR conversation_status = 'closed')::int AS tickets_closed,
          COUNT(DISTINCT glpi_ticket_id) FILTER (WHERE solution_action = 'reopen' AND solution_status = 'success')::int AS tickets_reopened,
          COUNT(DISTINCT glpi_ticket_id) FILTER (WHERE inactivity_status = 'autoclose_done')::int AS tickets_closed_by_inactivity,
          ROUND(AVG(first_response_seconds) FILTER (WHERE first_response_seconds IS NOT NULL))::int AS avg_first_response_seconds,
          ROUND(AVG(solution_seconds) FILTER (WHERE solution_seconds IS NOT NULL))::int AS avg_solution_seconds,
          COUNT(*) FILTER (WHERE sla_state = 'risk')::int AS sla_risk,
          COUNT(*) FILTER (WHERE sla_state = 'violated')::int AS sla_violated
        FROM base
      `,
      params,
    );

    return result.rows[0] ?? {};
  }

  private async queryDelivery(filters: NormalizedFilters, params: unknown[]): Promise<Record<string, unknown>> {
    const result = await this.executor.query(
      `
        WITH base AS (${baseConversationSql(filters)})
        SELECT
          COALESCE(m.delivery_status, 'unknown') AS status,
          COUNT(*)::int AS total,
          COALESCE(m.meta_error_code, '') AS error_code,
          LEFT(COALESCE(m.meta_error_message_sanitized, ''), 160) AS error_message_sanitized
        FROM base b
        JOIN glpi_plugin_integaglpi_messages m
          ON m.conversation_id = b.conversation_id
         AND m.direction = 'outbound'
         AND m.created_at >= $1::timestamptz
         AND m.created_at <= $2::timestamptz
        GROUP BY COALESCE(m.delivery_status, 'unknown'), COALESCE(m.meta_error_code, ''), LEFT(COALESCE(m.meta_error_message_sanitized, ''), 160)
        ORDER BY total DESC
      `,
      params,
    );
    const rows = result.rows;

    return {
      total_outbound: rows.reduce((sum, row) => sum + Number(row.total ?? 0), 0),
      delivered: sumByStatus(rows, 'delivered'),
      read: sumByStatus(rows, 'read'),
      failed: sumByStatus(rows, 'failed'),
      rows: collapseStatusRows(rows),
      failures: rows.filter((row) => row.status === 'failed').slice(0, 20),
    };
  }

  private async queryInactivity(filters: NormalizedFilters, params: unknown[]): Promise<Record<string, unknown>> {
    const result = await this.executor.query(
      `
        WITH base AS (${baseConversationSql(filters)})
        SELECT
          COALESCE(e.status, 'unknown') AS status,
          COALESCE(e.event_key, '') AS event_key,
          COALESCE(e.reason, '') AS reason,
          COUNT(*)::int AS total
        FROM base b
        JOIN glpi_plugin_integaglpi_inactivity_job_events e
          ON e.conversation_id = b.conversation_id
         AND e.created_at >= $1::timestamptz
         AND e.created_at <= $2::timestamptz
        GROUP BY COALESCE(e.status, 'unknown'), COALESCE(e.event_key, ''), COALESCE(e.reason, '')
        ORDER BY total DESC
      `,
      params,
    );
    const rows = result.rows;

    return {
      reminders_sent: rows
        .filter((row) => row.status === 'sent' && String(row.event_key ?? '').startsWith('inactivity_reminder_'))
        .reduce((sum, row) => sum + Number(row.total ?? 0), 0),
      autoclose_done: rows
        .filter((row) => row.event_key === 'inactivity_autoclose_message' && row.status === 'sent')
        .reduce((sum, row) => sum + Number(row.total ?? 0), 0),
      rows,
      skips: rows.filter((row) => row.status === 'skipped').slice(0, 20),
    };
  }

  private async queryCsat(filters: NormalizedFilters, params: unknown[]): Promise<{ average: number | null; rows: QueryResultRow[] }> {
    const result = await this.executor.query(
      `
        WITH base AS (${baseConversationSql(filters)})
        SELECT
          COALESCE(b.csat_rating, 'sem_resposta') AS csat_rating,
          COUNT(DISTINCT b.glpi_ticket_id)::int AS total
        FROM base b
        WHERE b.glpi_ticket_id > 0
        GROUP BY COALESCE(b.csat_rating, 'sem_resposta')
        ORDER BY total DESC
      `,
      params,
    );
    const score: Record<string, number> = { very_satisfied: 5, satisfied: 4, neutral: 3, dissatisfied: 2, very_dissatisfied: 1 };
    let scoredTotal = 0;
    let scoredCount = 0;
    for (const row of result.rows) {
      const rating = String(row.csat_rating ?? '');
      if (score[rating] !== undefined) {
        scoredTotal += score[rating] * Number(row.total ?? 0);
        scoredCount += Number(row.total ?? 0);
      }
    }

    return {
      average: scoredCount > 0 ? Math.round((scoredTotal / scoredCount) * 100) / 100 : null,
      rows: result.rows,
    };
  }

  private async queryAiFlags(filters: NormalizedFilters, params: unknown[]): Promise<QueryResultRow[]> {
    const result = await this.executor.query(
      `
        WITH base AS (${baseConversationSql(filters)})
        SELECT flag, COUNT(*)::int AS total
        FROM (
          SELECT jsonb_array_elements_text(COALESCE(a.flags, '[]'::jsonb)) AS flag
          FROM base b
          JOIN glpi_plugin_integaglpi_ai_quality_analyses a
            ON a.glpi_ticket_id = b.glpi_ticket_id
           AND a.created_at >= $1::timestamptz
           AND a.created_at <= $2::timestamptz
           AND a.status = 'completed'
        ) flags
        GROUP BY flag
        ORDER BY total DESC
        LIMIT 20
      `,
      params,
    );

    return result.rows;
  }

  private async queryAiFeedback(filters: NormalizedFilters, params: unknown[]): Promise<QueryResultRow[]> {
    const result = await this.executor.query(
      `
        WITH base AS (${baseConversationSql(filters)})
        SELECT COALESCE(a.supervisor_feedback, 'sem_feedback') AS supervisor_feedback, COUNT(*)::int AS total
        FROM base b
        JOIN glpi_plugin_integaglpi_ai_quality_analyses a
          ON a.glpi_ticket_id = b.glpi_ticket_id
         AND a.created_at >= $1::timestamptz
         AND a.created_at <= $2::timestamptz
        GROUP BY COALESCE(a.supervisor_feedback, 'sem_feedback')
        ORDER BY total DESC
      `,
      params,
    );

    return result.rows;
  }

  private async queryContracts(filters: NormalizedFilters): Promise<{ alerts: number; rows: QueryResultRow[] }> {
    const result = await this.executor.query(
      `
        WITH usage AS (
          SELECT
            ec.glpi_entity_id,
            MAX(ec.glpi_entity_name) AS glpi_entity_name,
            SUM(ec.allocated_hours)::numeric AS allocated_hours,
            COALESCE(SUM(ha.adjusted_hours), 0)::numeric AS consumed_hours
          FROM glpi_plugin_integaglpi_entity_contracts ec
          LEFT JOIN glpi_plugin_integaglpi_hour_adjustments ha
            ON ha.contract_id = ec.id
           AND ha.created_at >= $2::timestamptz
           AND ha.created_at <= $3::timestamptz
          WHERE ec.is_active = TRUE
            AND ec.glpi_entity_id = ANY($1::bigint[])
            AND ec.period_start <= $3::date
            AND ec.period_end >= $2::date
          GROUP BY ec.glpi_entity_id
        )
        SELECT
          glpi_entity_id,
          glpi_entity_name,
          allocated_hours,
          consumed_hours,
          CASE WHEN allocated_hours > 0 THEN ROUND((consumed_hours / allocated_hours) * 100, 2) ELSE 0 END AS usage_percent,
          CASE
            WHEN allocated_hours > 0 AND (consumed_hours / allocated_hours) * 100 >= 100 THEN 'exhausted'
            WHEN allocated_hours > 0 AND (consumed_hours / allocated_hours) * 100 >= 90 THEN 'critical'
            WHEN allocated_hours > 0 AND (consumed_hours / allocated_hours) * 100 >= 70 THEN 'warning'
            ELSE 'ok'
          END AS alert_status
        FROM usage
        ORDER BY usage_percent DESC
        LIMIT 50
      `,
      [filters.entityIds, filters.dateFromSql, filters.dateToSql],
    );

    return {
      alerts: result.rows.filter((row) => row.alert_status !== 'ok').length,
      rows: result.rows,
    };
  }

  private async queryRows(filters: NormalizedFilters, params: unknown[]): Promise<QueryResultRow[]> {
    const result = await this.executor.query(
      `
        WITH base AS (${baseConversationSql(filters)})
        SELECT
          conversation_id,
          masked_phone,
          glpi_ticket_id,
          entity_id,
          entity_name,
          queue_id,
          queue_name,
          assigned_user_id,
          conversation_status,
          last_message_at,
          last_message_excerpt,
          last_delivery_status,
          inactivity_status,
          csat_rating,
          sla_state,
          ai_sentiment,
          ai_flags,
          ai_recommendation,
          ai_supervisor_feedback,
          ai_status,
          contract_alert_status
        FROM base
        ORDER BY
          CASE
            WHEN last_delivery_status = 'failed' THEN 1
            WHEN sla_state = 'violated' THEN 2
            WHEN inactivity_status = 'failed' THEN 3
            WHEN sla_state = 'risk' THEN 4
            ELSE 9
          END ASC,
          last_message_at DESC NULLS LAST
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `,
      [...params, filters.limit, (filters.page - 1) * filters.limit],
    );

    return result.rows;
  }

  private async queryRowTotal(filters: NormalizedFilters, params: unknown[]): Promise<number> {
    const result = await this.executor.query(
      `WITH base AS (${baseConversationSql(filters)}) SELECT COUNT(*)::int AS total FROM base`,
      params,
    );

    return Number(result.rows[0]?.total ?? 0);
  }

  private buildCacheKey(filters: NormalizedFilters): string {
    const hash = createHash('sha256').update(JSON.stringify(serializeFilters(filters))).digest('hex');
    return `integaglpi:quality-dashboard:v1:${hash}`;
  }

  private async readCache(key: string): Promise<Record<string, unknown> | null> {
    try {
      const raw = await this.cache.get(key);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw) as unknown;
      return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
    } catch {
      return null;
    }
  }

  private async writeCache(key: string, value: Record<string, unknown>): Promise<void> {
    try {
      await this.cache.setex(key, CACHE_TTL_SECONDS, JSON.stringify(value));
    } catch {
      // Read-only dashboard must remain available when Redis is temporarily unavailable.
    }
  }
}

interface NormalizedFilters extends QualityDashboardFilters {
  dateFromSql: string;
  dateToSql: string;
}

function normalizeFilters(filters: QualityDashboardFilters): NormalizedFilters {
  const dateFrom = parseDate(filters.dateFrom);
  const dateTo = parseDate(filters.dateTo);
  if (dateFrom === null || dateTo === null) {
    throw new QualityDashboardError(400, 'DATE_RANGE_REQUIRED', 'Informe um período válido para o dashboard.');
  }
  if (dateTo.getTime() < dateFrom.getTime()) {
    throw new QualityDashboardError(400, 'DATE_RANGE_INVALID', 'A data final deve ser maior ou igual à data inicial.');
  }
  if ((dateTo.getTime() - dateFrom.getTime()) / 86_400_000 > MAX_DAYS) {
    throw new QualityDashboardError(400, 'DATE_RANGE_TOO_LARGE', 'O período máximo permitido é de 30 dias.');
  }

  const entityIds = [...new Set(filters.entityIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  if (entityIds.length === 0) {
    throw new QualityDashboardError(403, 'ENTITY_SCOPE_REQUIRED', 'Nenhuma entidade GLPI permitida foi informada.');
  }

  return {
    ...filters,
    entityIds,
    page: Math.max(1, filters.page),
    limit: Math.max(1, Math.min(filters.limit, 50)),
    dateFromSql: `${filters.dateFrom}T00:00:00.000Z`,
    dateToSql: `${filters.dateTo}T23:59:59.999Z`,
  };
}

function parseDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function buildBaseParams(filters: NormalizedFilters): unknown[] {
  return [
    filters.dateFromSql,
    filters.dateToSql,
    filters.entityIds,
    filters.queueId ?? null,
    filters.technicianId ?? null,
    filters.status ?? null,
    filters.csat ?? null,
    filters.sla ?? null,
    filters.deliveryStatus ?? null,
    filters.inactivity ?? null,
  ];
}

function baseConversationSql(_filters: NormalizedFilters): string {
  return `
    SELECT
      c.id AS conversation_id,
      CASE
        WHEN length(regexp_replace(c.phone_e164, '\\D', '', 'g')) <= 4 THEN '****'
        ELSE substr(regexp_replace(c.phone_e164, '\\D', '', 'g'), 1, 2)
          || '******'
          || right(regexp_replace(c.phone_e164, '\\D', '', 'g'), 4)
      END AS masked_phone,
      COALESCE(c.glpi_ticket_id, 0) AS glpi_ticket_id,
      COALESCE(c.glpi_entity_id, cem.glpi_entity_id, esa.glpi_entity_id) AS entity_id,
      COALESCE(c.glpi_entity_name, cem.glpi_entity_name, esa.glpi_entity_name) AS entity_name,
      COALESCE(rt.queue_id, c.queue_id) AS queue_id,
      q.name AS queue_name,
      rt.assigned_user_id,
      c.status AS conversation_status,
      c.created_at,
      c.updated_at,
      c.last_message_at,
      LEFT(COALESCE(lm.message_text, ''), 180) AS last_message_excerpt,
      ld.delivery_status AS last_delivery_status,
      it.status AS inactivity_status,
      it.skip_reason AS inactivity_skip_reason,
      sa.csat_rating,
      COALESCE(sa.supervisor_review_required, FALSE) AS supervisor_review_required,
      sa.final_ticket_status,
      sa.action AS solution_action,
      sa.status AS solution_status,
      CASE
        WHEN fi.first_inbound_at IS NOT NULL AND fo.first_outbound_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (fo.first_outbound_at - fi.first_inbound_at))::int
        ELSE NULL
      END AS first_response_seconds,
      CASE
        WHEN c.created_at IS NOT NULL AND sa.solution_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (sa.solution_at - c.created_at))::int
        ELSE NULL
      END AS solution_seconds,
      CASE
        WHEN c.status = 'open' AND c.last_message_at < NOW() - INTERVAL '24 hours' THEN 'violated'
        WHEN c.status = 'open' AND c.last_message_at < NOW() - INTERVAL '4 hours' THEN 'risk'
        ELSE 'ok'
      END AS sla_state,
      ai.sentiment AS ai_sentiment,
      ai.flags AS ai_flags,
      ai.recommendation AS ai_recommendation,
      ai.supervisor_feedback AS ai_supervisor_feedback,
      ai.status AS ai_status,
      contract_status.alert_status AS contract_alert_status
    FROM glpi_plugin_integaglpi_conversations c
    LEFT JOIN glpi_plugin_integaglpi_conversation_runtime rt
      ON rt.conversation_id = c.id
    LEFT JOIN glpi_plugin_integaglpi_queues q
      ON q.id = COALESCE(rt.queue_id, c.queue_id)
    LEFT JOIN glpi_plugin_integaglpi_contact_entity_memory cem
      ON cem.phone_e164 = c.phone_e164
     AND cem.is_active = TRUE
    LEFT JOIN LATERAL (
      SELECT glpi_entity_id, glpi_entity_name
      FROM glpi_plugin_integaglpi_entity_selection_attempts
      WHERE conversation_id = c.id
        AND status IN ('succeeded', 'reconciled')
      ORDER BY updated_at DESC
      LIMIT 1
    ) esa ON TRUE
    LEFT JOIN LATERAL (
      SELECT message_text
      FROM glpi_plugin_integaglpi_messages
      WHERE conversation_id = c.id
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    ) lm ON TRUE
    LEFT JOIN LATERAL (
      SELECT delivery_status
      FROM glpi_plugin_integaglpi_messages
      WHERE conversation_id = c.id
        AND direction = 'outbound'
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    ) ld ON TRUE
    LEFT JOIN LATERAL (
      SELECT created_at AS first_inbound_at
      FROM glpi_plugin_integaglpi_messages
      WHERE conversation_id = c.id
        AND direction = 'inbound'
      ORDER BY created_at ASC
      LIMIT 1
    ) fi ON TRUE
    LEFT JOIN LATERAL (
      SELECT created_at AS first_outbound_at
      FROM glpi_plugin_integaglpi_messages
      WHERE conversation_id = c.id
        AND direction = 'outbound'
        AND (fi.first_inbound_at IS NULL OR created_at >= fi.first_inbound_at)
      ORDER BY created_at ASC
      LIMIT 1
    ) fo ON TRUE
    LEFT JOIN glpi_plugin_integaglpi_inactivity_tracking it
      ON it.conversation_id = c.id
    LEFT JOIN LATERAL (
      SELECT
        csat_rating,
        supervisor_review_required,
        final_ticket_status,
        action,
        status,
        updated_at AS solution_at
      FROM glpi_plugin_integaglpi_solution_actions
      WHERE ticket_id = c.glpi_ticket_id
      ORDER BY updated_at DESC
      LIMIT 1
    ) sa ON TRUE
    LEFT JOIN LATERAL (
      SELECT sentiment, flags, recommendation, supervisor_feedback, status
      FROM glpi_plugin_integaglpi_ai_quality_analyses
      WHERE glpi_ticket_id = c.glpi_ticket_id
      ORDER BY created_at DESC
      LIMIT 1
    ) ai ON TRUE
    LEFT JOIN LATERAL (
      SELECT
        CASE
          WHEN SUM(ec.allocated_hours) > 0 AND (COALESCE(SUM(ha.adjusted_hours), 0) / SUM(ec.allocated_hours)) * 100 >= 100 THEN 'exhausted'
          WHEN SUM(ec.allocated_hours) > 0 AND (COALESCE(SUM(ha.adjusted_hours), 0) / SUM(ec.allocated_hours)) * 100 >= 90 THEN 'critical'
          WHEN SUM(ec.allocated_hours) > 0 AND (COALESCE(SUM(ha.adjusted_hours), 0) / SUM(ec.allocated_hours)) * 100 >= 70 THEN 'warning'
          ELSE 'ok'
        END AS alert_status
      FROM glpi_plugin_integaglpi_entity_contracts ec
      LEFT JOIN glpi_plugin_integaglpi_hour_adjustments ha
        ON ha.contract_id = ec.id
       AND ha.created_at >= $1::timestamptz
       AND ha.created_at <= $2::timestamptz
      WHERE ec.is_active = TRUE
        AND ec.glpi_entity_id = COALESCE(c.glpi_entity_id, cem.glpi_entity_id, esa.glpi_entity_id)
        AND ec.period_start <= $2::date
        AND ec.period_end >= $1::date
    ) contract_status ON TRUE
    WHERE c.created_at >= $1::timestamptz
      AND c.created_at <= $2::timestamptz
      AND COALESCE(c.glpi_entity_id, cem.glpi_entity_id, esa.glpi_entity_id) = ANY($3::bigint[])
      AND ($4::bigint IS NULL OR COALESCE(rt.queue_id, c.queue_id) = $4::bigint)
      AND ($5::bigint IS NULL OR rt.assigned_user_id = $5::bigint)
      AND ($6::text IS NULL OR c.status = $6::text)
      AND ($7::text IS NULL OR sa.csat_rating = $7::text OR ($7::text = 'sem_resposta' AND sa.csat_rating IS NULL))
      AND ($8::text IS NULL OR (
        CASE
          WHEN c.status = 'open' AND c.last_message_at < NOW() - INTERVAL '24 hours' THEN 'violated'
          WHEN c.status = 'open' AND c.last_message_at < NOW() - INTERVAL '4 hours' THEN 'risk'
          ELSE 'ok'
        END
      ) = $8::text)
      AND ($9::text IS NULL OR ld.delivery_status = $9::text)
      AND ($10::text IS NULL OR it.status = $10::text)
  `;
}

function serializeFilters(filters: NormalizedFilters): Record<string, unknown> {
  return {
    date_from: filters.dateFrom,
    date_to: filters.dateTo,
    entity_ids: filters.entityIds,
    queue_id: filters.queueId ?? null,
    technician_id: filters.technicianId ?? null,
    status: filters.status ?? null,
    csat: filters.csat ?? null,
    sla: filters.sla ?? null,
    delivery_status: filters.deliveryStatus ?? null,
    inactivity: filters.inactivity ?? null,
    page: filters.page,
    limit: filters.limit,
  };
}

function sumByStatus(rows: QueryResultRow[], status: string): number {
  return rows
    .filter((row) => row.status === status)
    .reduce((sum, row) => sum + Number(row.total ?? 0), 0);
}

function collapseStatusRows(rows: QueryResultRow[]): DashboardRow[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const status = String(row.status ?? 'unknown');
    totals.set(status, (totals.get(status) ?? 0) + Number(row.total ?? 0));
  }

  return [...totals.entries()].map(([status, total]) => ({ status, total }));
}
