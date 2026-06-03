/**
 * AI/KB ecosystem REST controllers.
 *
 * Routes (all bearer-gated at app.ts; RBAC + CSRF are enforced by the PHP plugin
 * before it calls these internal endpoints):
 *   POST /internal/glpi/ai/smart-help
 *   POST /internal/glpi/ai/external-research/dynamic
 *   GET  /internal/glpi/ai/coaching/checklist
 *   POST /internal/glpi/ai/coaching/suggest-kb
 *   GET  /internal/glpi/ai/metrics/effectiveness
 *
 * Safety: local-first (SmartHelp), cloud only with explicit humanConsent, PII
 * sanitized before any cloud call, aggregated metrics only (no technician identity),
 * no ticket mutation, no auto-publish, no auto-send.
 */

import type { Request, Response } from 'express';

import type { SmartHelpService } from '../domain/services/SmartHelpService.js';
import type { ExternalResearchService } from '../domain/services/ExternalResearchService.js';
import type { CoachingService } from '../domain/services/CoachingService.js';
import type { FeedbackService } from '../domain/services/FeedbackService.js';
import type { CloudAuditRepository } from '../repositories/postgres/PostgresCloudAuditRepository.js';
import { logger } from '../infra/logger/logger.js';

function intOrNull(value: unknown): number | null {
  const n = parseInt(String(value ?? ''), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function fail(response: Response, code: number, message: string): Response {
  return response.status(code).json({ ok: false, message });
}

/** POST /internal/glpi/ai/smart-help */
export function createSmartHelpController(service: SmartHelpService) {
  return async (request: Request, response: Response): Promise<Response> => {
    try {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const ticketId = intOrNull(body.ticket_id);
      if (ticketId === null) {
        return fail(response, 400, 'ticket_id obrigatório.');
      }
      const result = await service.assist({
        ticketId,
        summary: String(body.summary ?? ''),
        category: body.category !== undefined ? String(body.category) : undefined,
      });
      return response.status(200).json({ ...result, read_only: true });
    } catch (error: unknown) {
      logger.error({ error_message: error instanceof Error ? error.message : String(error) }, '[ai][smart-help]');
      return fail(response, 500, 'Smart Help indisponível.');
    }
  };
}

/** POST /internal/glpi/ai/external-research/dynamic */
export function createExternalResearchDynamicController(service: ExternalResearchService) {
  return async (request: Request, response: Response): Promise<Response> => {
    try {
      const body = (request.body ?? {}) as Record<string, unknown>;
      // human_consent MUST be explicitly true — proves a human click reached here.
      const humanConsent = body.human_consent === true || body.human_consent === 'true';
      const result = await service.researchDynamic({
        context: String(body.context ?? ''),
        ticketId: intOrNull(body.ticket_id),
        profileId: intOrNull(body.profile_id),
        category: body.category !== undefined ? String(body.category) : null,
        provider: body.provider !== undefined ? String(body.provider) : null,
        humanConsent,
      });
      const code = result.ok
        ? 200
        : result.status === 'no_consent'
          ? 403
          : result.status === 'blocked_pii'
            ? 422
            // no_actionable_result is a valid, honest answer ("nothing useful") —
            // not a transport failure, so surface it as 200 for the panel to show.
            : result.status === 'no_actionable_result'
              ? 200
              : 503;
      return response.status(code).json({ ...result, read_only: true, remote_execution: false });
    } catch (error: unknown) {
      logger.error({ error_message: error instanceof Error ? error.message : String(error) }, '[ai][external-research]');
      return fail(response, 500, 'Pesquisa externa indisponível.');
    }
  };
}

/** GET /internal/glpi/ai/coaching/checklist?ticket_id=&technician_id=&category= */
export function createCoachingChecklistController(service: CoachingService) {
  return async (request: Request, response: Response): Promise<Response> => {
    try {
      const q = request.query as Record<string, unknown>;
      const ticketId = intOrNull(q.ticket_id);
      if (ticketId === null) {
        return fail(response, 400, 'ticket_id obrigatório.');
      }
      const result = await service.getChecklist({
        ticketId,
        technicianId: intOrNull(q.technician_id),
        category: q.category !== undefined ? String(q.category) : undefined,
      });
      return response.status(200).json({ ok: true, ...result });
    } catch (error: unknown) {
      logger.error({ error_message: error instanceof Error ? error.message : String(error) }, '[ai][coaching-checklist]');
      return fail(response, 500, 'Coaching indisponível.');
    }
  };
}

/** POST /internal/glpi/ai/coaching/suggest-kb */
export function createCoachingSuggestKbController(service: CoachingService) {
  return async (request: Request, response: Response): Promise<Response> => {
    try {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const ticketId = intOrNull(body.ticket_id);
      if (ticketId === null) {
        return fail(response, 400, 'ticket_id obrigatório.');
      }
      const result = await service.suggestKbArticle(ticketId);
      // Never publishes — the candidate is returned for manual review only.
      return response.status(result.ok ? 200 : 200).json({ ...result, auto_publish: false });
    } catch (error: unknown) {
      logger.error({ error_message: error instanceof Error ? error.message : String(error) }, '[ai][suggest-kb]');
      return fail(response, 500, 'Sugestão de KB indisponível.');
    }
  };
}

/** GET /internal/glpi/ai/metrics/effectiveness — aggregated only, no technician identity. */
export function createAiMetricsController(feedback: FeedbackService, cloudAudit: CloudAuditRepository) {
  return async (request: Request, response: Response): Promise<Response> => {
    try {
      const q = request.query as Record<string, unknown>;
      const limit = intOrNull(q.limit) ?? 50;
      const [articleEffectiveness, cloudGap] = await Promise.all([
        feedback.getCategoryEffectiveness(limit),
        cloudAudit.getCloudGapByCategory(limit),
      ]);
      return response.status(200).json({
        ok: true,
        aggregated: true,
        non_punitive: true,
        article_effectiveness_by_category: articleEffectiveness,
        cloud_gap_by_category: cloudGap,
      });
    } catch (error: unknown) {
      logger.error({ error_message: error instanceof Error ? error.message : String(error) }, '[ai][metrics]');
      return fail(response, 500, 'Métricas indisponíveis.');
    }
  };
}
