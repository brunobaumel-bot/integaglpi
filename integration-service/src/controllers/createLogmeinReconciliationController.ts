/**
 * Controllers for the LogMeIn remote-access reconciliation feature.
 *
 * Routes:
 *  POST /internal/glpi/logmein/reconciliation/sync           — trigger ledger sync
 *  GET  /internal/glpi/logmein/reconciliation/queue          — list regularization queue
 *  POST /internal/glpi/logmein/reconciliation/queue/:id/resolve — resolve a queue item
 *
 * Security:
 *  - All routes are bearer-gated (same key as /sync).
 *  - MATCH_STATUSES allowlist validates status transitions.
 *  - User ID, ticket ID, and task ID are validated as positive integers.
 *  - Notes are truncated to 500 chars.
 *  - No IP addresses, technician names, or credentials in any response.
 */

import type { Request, Response } from 'express';

import type { LogmeinReconciliationService } from '../domain/services/LogmeinReconciliationService.js';
import { MATCH_STATUSES } from '../domain/services/LogmeinReconciliationService.js';
import { logger } from '../infra/logger/logger.js';

const QUEUE_DEFAULT_LIMIT = 25;
const QUEUE_MAX_LIMIT = 50;

function safeInt(value: unknown, min = 1, max = Number.MAX_SAFE_INTEGER): number | null {
  const parsed = parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

/** POST /internal/glpi/logmein/reconciliation/sync */
export function createLogmeinReconciliationSyncController(service: LogmeinReconciliationService) {
  return async (request: Request, response: Response): Promise<Response> => {
    try {
      const body = request.body as Record<string, unknown>;
      const windowFromRaw = body.window_from !== undefined ? new Date(String(body.window_from)) : undefined;
      const windowToRaw = body.window_to !== undefined ? new Date(String(body.window_to)) : undefined;

      const windowFrom = windowFromRaw && Number.isFinite(windowFromRaw.getTime()) ? windowFromRaw : undefined;
      const windowTo = windowToRaw && Number.isFinite(windowToRaw.getTime()) ? windowToRaw : undefined;

      const result = await service.syncRemoteAccessSessions(windowFrom, windowTo);
      const httpStatus = result.ok ? 200
        : result.status === 'migration_required' || result.status === 'unconfigured' || result.status === 'sync_in_progress'
          ? 409
          : 503;

      return response.status(httpStatus).json({
        ok: result.ok,
        status: result.status,
        message: result.message,
        sessions_found: result.sessionsFound,
        sessions_inserted: result.sessionsInserted,
        sessions_skipped_duplicate: result.sessionsSkippedDuplicate,
        window_from: result.windowFrom,
        window_to: result.windowTo,
        duration_ms: result.durationMs,
        // Sanitized report-error context for the plugin (category + status only).
        report_error: result.reportError,
        report_status_code: result.reportStatusCode,
        report_reason: result.reportReason,
        primary_status_code: result.primaryStatusCode,
        fallback_status_code: result.fallbackStatusCode,
        fallback_used: result.fallbackUsed,
        lookback_hours: result.lookbackHours,
        lookback_days: result.lookbackDays,
        chunk_minutes: result.chunkMinutes,
        overlap_minutes: result.overlapMinutes,
        max_retries: result.maxRetries,
        cooldown_seconds: result.cooldownSeconds,
        circuit_open_until: result.circuitOpenUntil,
        read_only: true,
        remote_execution: false,
        post_action_only_reports: true,
      });
    } catch (error: unknown) {
      logger.error(
        {
          error_message: error instanceof Error ? error.message : String(error),
          read_only: true,
        },
        '[integration-service][logmein-reconciliation][SYNC_UNEXPECTED_ERROR]',
      );
      return response.status(500).json({
        ok: false,
        status: 'failed',
        message: 'Conciliação LogMeIn temporariamente indisponível.',
        read_only: true,
        remote_execution: false,
      });
    }
  };
}

/** GET /internal/glpi/logmein/reconciliation/queue */
export function createLogmeinReconciliationQueueController(service: LogmeinReconciliationService) {
  return async (request: Request, response: Response): Promise<Response> => {
    try {
      const query = request.query as Record<string, unknown>;
      const status = typeof query.status === 'string' && (MATCH_STATUSES as readonly string[]).includes(query.status)
        ? query.status
        : undefined;
      const entityId = safeInt(query.entity_id, 1) ?? undefined;
      const page = safeInt(query.page, 1, 200) ?? 1;
      const limit = Math.min(QUEUE_MAX_LIMIT, safeInt(query.limit, 1, QUEUE_MAX_LIMIT) ?? QUEUE_DEFAULT_LIMIT);

      const result = await service.listQueue({ status, entityId, page, limit });
      return response.status(200).json({
        ...result,
        read_only: true,
        non_punitive: true,
        technician_nominal_report: false,
      });
    } catch (error: unknown) {
      logger.error(
        { error_message: error instanceof Error ? error.message : String(error) },
        '[integration-service][logmein-reconciliation][QUEUE_ERROR]',
      );
      return response.status(500).json({ ok: false, message: 'Fila de conciliação temporariamente indisponível.' });
    }
  };
}

/** POST /internal/glpi/logmein/reconciliation/queue/:id/resolve */
export function createLogmeinReconciliationResolveController(service: LogmeinReconciliationService) {
  return async (request: Request, response: Response): Promise<Response> => {
    try {
      const id = safeInt(request.params.id, 1);
      if (id === null) {
        return response.status(400).json({ ok: false, message: 'ID inválido.' });
      }

      const body = request.body as Record<string, unknown>;
      const statusRaw = String(body.status ?? '');
      if (!(MATCH_STATUSES as readonly string[]).includes(statusRaw)) {
        return response.status(400).json({ ok: false, message: 'Status inválido.' });
      }
      const status = statusRaw as typeof MATCH_STATUSES[number];

      const ticketId = safeInt(body.ticket_id, 1);
      const taskId = safeInt(body.task_id, 1);
      const userId = safeInt(body.user_id, 1);
      if (userId === null) {
        return response.status(400).json({ ok: false, message: 'user_id obrigatório.' });
      }
      const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : null;

      const ok = await service.resolveQueueItem(id, { status, ticketId, taskId, userId, note });
      return response.status(ok ? 200 : 404).json({ ok, message: ok ? 'Resolvido.' : 'Item não encontrado.' });
    } catch (error: unknown) {
      logger.error(
        { error_message: error instanceof Error ? error.message : String(error) },
        '[integration-service][logmein-reconciliation][RESOLVE_ERROR]',
      );
      return response.status(500).json({ ok: false, message: 'Erro ao resolver item.' });
    }
  };
}
