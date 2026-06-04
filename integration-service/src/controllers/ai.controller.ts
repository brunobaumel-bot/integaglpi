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

/**
 * Local technical summarizer port. Implemented in buildDependencies with an
 * Ollama-backed generator. LOCAL provider only — never cloud.
 */
export interface TechnicalSummarizerPort {
  generate(input: { ticketId: number; context: string }): Promise<string>;
}

/**
 * Deterministic anti-hallucination guard for the local summary. The model sometimes
 * invents context (GLPI, banco de dados, "registro/atualização de informações",
 * "teste com o sistema") that is NOT present in the actual conversation. We remove
 * such fabricated phrases when their trigger term is absent from the sanitized input,
 * replacing them with an honest "detalhes técnicos ainda não informados". Real terms
 * that appear in the input are preserved.
 */
const SUMMARY_FABRICATION_GUARD: Array<{ phrase: RegExp; needs: RegExp }> = [
  { phrase: /\bteste[s]?\s+com\s+o\s+sistema\s+glpi\b/gi, needs: /\bglpi\b/i },
  { phrase: /\bsistema\s+glpi\b/gi, needs: /\bglpi\b/i },
  { phrase: /\bglpi\b/gi, needs: /\bglpi\b/i },
  { phrase: /\bbanco\s+de\s+dados\b/gi, needs: /\bbanco\s+de\s+dados|database\b/i },
  { phrase: /\bregistro\s+ou\s+atualiza[çc][ãa]o\s+de\s+informa[çc][õo]es\b/gi, needs: /\bregistro|atualiza[çc]/i },
  { phrase: /\bprocessamento\s+dos\s+registros\b/gi, needs: /\bprocessamento|registro/i },
];

/**
 * Neutralizes RESIDUAL person/company constructions and labeled placeholders that the
 * upstream sanitizer leaves behind (e.g. "O [nome removido], da empresa Etica
 * Informatica", "[nome: [nome]]"). These still read as PII to the cloud guard. We strip
 * the company phrase, drop labeled bracket placeholders entirely and restore a neutral
 * grammatical subject — producing cloud-ready technical prose.
 */
const COMPANY_PHRASES: RegExp[] = [
  /\bd[ao]\s+empresa\s+[^,.;:]+/giu,
  /\bempresa\s+informada\s*[:\-]?\s*[^,.;:]+/giu,
  /\bempresa\s+[A-ZÀ-Ý][\p{L}\p{N}.&\- ]{1,40}/gu,
  /\b[A-ZÀ-Ý][\p{L}\p{N}]+\s+inform[aá]tica\b/giu,
];

export function neutralizeResidualPii(text: string): string {
  let t = String(text ?? '');
  for (const re of COMPANY_PHRASES) {
    t = t.replace(re, 'em ambiente corporativo');
  }
  // Remove labeled bracket placeholders, twice to catch nested "[nome: [nome]]".
  t = t.replace(/\[[^[\]]*\]/g, '');
  t = t.replace(/\[[^[\]]*\]/g, '');
  // Restore a neutral subject where a placeholder left a dangling article.
  t = t.replace(/\bO\s+,/g, 'O solicitante,').replace(/\bA\s+,/g, 'O solicitante,');
  t = t.replace(/\b[Cc]liente\s+(?=[,.;:]|$)/g, 'o solicitante ');
  // Whitespace / dangling-punctuation cleanup.
  t = t.replace(/\s{2,}/g, ' ').replace(/\s+([,.;:])/g, '$1').replace(/([,;:])\1+/g, '$1');
  return t.replace(/^[\s,;:.]+/, '').trim();
}

export function scrubSummaryFabrications(summary: string, context: string): string {
  const ctx = String(context ?? '').toLowerCase();
  let out = String(summary ?? '');
  for (const guard of SUMMARY_FABRICATION_GUARD) {
    if (!guard.needs.test(ctx)) {
      out = out.replace(guard.phrase, 'detalhes técnicos ainda não informados');
    }
  }
  // Collapse repeated replacement phrases and whitespace.
  out = out.replace(/(detalhes técnicos ainda não informados)(\s*[,.;]?\s*\1)+/gi, '$1');
  out = out.replace(/\s+/g, ' ').trim();
  return out;
}

/**
 * POST /internal/glpi/ai/technical-summary
 *
 * Generates a short, PII-free technical summary using the LOCAL AI provider only.
 * Always returns HTTP 200 with a typed envelope so the PHP caller can degrade to its
 * deterministic fallback without treating transport as a hard error. Never calls
 * cloud, never mutates a ticket, never sends WhatsApp, never persists raw content.
 */
export function createTechnicalSummaryController(summarizer: TechnicalSummarizerPort) {
  return async (request: Request, response: Response): Promise<Response> => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const ticketId = intOrNull(body.ticket_id);
    if (ticketId === null) {
      return fail(response, 400, 'ticket_id obrigatório.');
    }
    const context = String(body.context ?? '').trim();
    if (context === '') {
      return response.status(200).json({
        ok: false,
        error_type: 'missing_context',
        summary_source: 'fallback',
        technical_summary: '',
        technicalSummary: '',
        read_only: true,
      });
    }
    try {
      const raw = (await summarizer.generate({ ticketId, context })).trim();
      // Strip fabricated context, then neutralize residual person/company/placeholders.
      const summary = neutralizeResidualPii(scrubSummaryFabrications(raw, context));
      if (summary === '') {
        return response.status(200).json({
          ok: false,
          error_type: 'provider_unavailable',
          summary_source: 'fallback',
          technical_summary: '',
          technicalSummary: '',
          read_only: true,
        });
      }
      return response.status(200).json({
        ok: true,
        technical_summary: summary,
        technicalSummary: summary,
        summary_source: 'local_ai',
        read_only: true,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const errorType = /timeout|timed out|aborted/i.test(message) ? 'local_ai_timeout' : 'provider_unavailable';
      logger.error({ error_message: message }, '[ai][technical-summary]');
      return response.status(200).json({
        ok: false,
        error_type: errorType,
        summary_source: 'fallback',
        technical_summary: '',
        technicalSummary: '',
        read_only: true,
      });
    }
  };
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
      // Same safety flag as the preview step: residual mode rewrites + blocks on
      // residual; default OFF keeps the strict block-on-detected (raw) policy.
      const policy = process.env.SMARTHELP_CLOUD_RESIDUAL_MODE === '1' ? 'residual' : 'detected';
      const result = await service.researchDynamic({
        context: String(body.context ?? ''),
        ticketId: intOrNull(body.ticket_id),
        profileId: intOrNull(body.profile_id),
        category: body.category !== undefined ? String(body.category) : null,
        provider: body.provider !== undefined ? String(body.provider) : null,
        humanConsent,
        policy,
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

/**
 * POST /internal/glpi/ai/external-research/preview
 *
 * Step 1 of the two-step cloud flow: sanitize the context and return a SAFE preview.
 * NEVER calls the cloud and NEVER echoes the raw context. Returns the sanitized text,
 * the detected PII kinds (for operator transparency) and `safe_for_cloud` (= the PII
 * Guard did NOT flag the context). The actual send still goes through researchDynamic,
 * which re-sanitizes and blocks on PII independently — this preview never relaxes that.
 */
export function createExternalResearchPreviewController(service: ExternalResearchService) {
  return async (request: Request, response: Response): Promise<Response> => {
    try {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const context = String(body.context ?? '');
      if (context.trim() === '') {
        return response.status(400).json({
          ok: false,
          error_type: 'missing_context',
          safe_for_cloud: false,
          message: 'Contexto vazio para pré-visualização.',
          read_only: true,
        });
      }
      // Cloud-safe REWRITE of the local summary (deterministic; never raw ticket).
      const rw = service.rewriteCloudSafe(context);
      // Safety flag: residual mode (default OFF = strict block-on-detected). When OFF
      // the legacy strict behavior is preserved; homologation may enable it manually.
      const residualMode = process.env.SMARTHELP_CLOUD_RESIDUAL_MODE === '1';
      const safeForCloud = residualMode ? rw.safeForCloudResidual : rw.safeForCloudStrict;
      return response.status(200).json({
        ok: true,
        // Cloud-safe text only — raw context/ticket is never returned.
        cloud_safe_context: rw.cloudSafeContext,
        sanitized_text: rw.cloudSafeContext, // back-compat alias for the panel JS
        detected_kinds: rw.detectedKinds,
        removed_kinds: rw.removedKinds,
        safe_for_cloud: safeForCloud,
        blocked_reason: safeForCloud ? null : (rw.blockedReason ?? 'PII_DETECTED'),
        payload_hash: rw.payloadHash,
        char_count: rw.charCount,
        source: rw.source,
        residual_mode: residualMode,
        read_only: true,
        remote_execution: false,
      });
    } catch (error: unknown) {
      logger.error({ error_message: error instanceof Error ? error.message : String(error) }, '[ai][external-research-preview]');
      return fail(response, 500, 'Pré-visualização da pesquisa externa indisponível.');
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
