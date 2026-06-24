/**
 * KB RAG Copilot controller.
 *
 * Route: POST /internal/glpi/ai/kb-rag
 *
 * Bearer-gated (INTEGRATION_SERVICE_API_KEY).
 * RBAC + CSRF enforced by the PHP plugin before this internal endpoint is called.
 *
 * Input:
 *   { query: string, ticketId?: number, technicianId?: number, topK?: number }
 *
 * Output:
 *   { ok, query, playbook, kbsUsed, source, localAiUsed, deterministicFallback, kbsFound }
 *
 * Invariants:
 *   - No cloud AI.
 *   - No ticket mutation.
 *   - No auto-send to customer.
 *   - No command execution.
 *   - Node never touches MariaDB GLPI directly.
 *
 * Phase: integaglpi_local_kb_rag_technician_copilot_001
 */

/**
 * KB RAG Copilot controller.
 *
 * Route: POST /internal/glpi/ai/kb-rag
 *
 * Bearer-gated (INTEGRATION_SERVICE_API_KEY).
 * RBAC + CSRF enforced by the PHP plugin before this internal endpoint is called.
 *
 * Input:
 *   {
 *     query: string,
 *     ticketId?: number,
 *     technicianId?: number,
 *     topK?: number,
 *     clientContext?: {
 *       entityId?: number,
 *       clientName?: string,
 *       productOrSystem?: string,
 *       category?: string
 *     }
 *   }
 *
 * Output:
 *   { ok, query, expandedTerms, playbook, kbsUsed, kbsScoreBreakdown,
 *     source, localAiUsed, deterministicFallback, kbsFound }
 *
 * Invariants:
 *   - No cloud AI.
 *   - No ticket mutation.
 *   - No auto-send to customer.
 *   - No command execution.
 *   - Node never touches MariaDB GLPI directly.
 *   - clientContext is for ranking boost only (never hard filter, never persisted).
 *
 * Phase: integaglpi_local_kb_rag_technician_copilot_001
 * Adendo: integaglpi_local_kb_rag_model_query_expansion_adendum_001
 */

import type { Request, Response } from 'express';
import type { KbRagCopilotService, KbClientContext } from '../domain/services/KbRagCopilotService.js';

const MAX_QUERY_LENGTH = 1000;

function intOrNull(value: unknown): number | null {
  const n = parseInt(String(value ?? ''), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function parseClientContext(raw: unknown): KbClientContext | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const ctx: KbClientContext = {};
  if (typeof obj['entityId'] === 'number' || typeof obj['entity_id'] === 'number') {
    ctx.entityId = (obj['entityId'] ?? obj['entity_id']) as number;
  }
  if (typeof obj['productOrSystem'] === 'string' || typeof obj['product_or_system'] === 'string') {
    const v = String(obj['productOrSystem'] ?? obj['product_or_system'] ?? '').trim().slice(0, 100);
    if (v) ctx.productOrSystem = v;
  }
  if (typeof obj['category'] === 'string') {
    const v = String(obj['category']).trim().slice(0, 100);
    if (v) ctx.category = v;
  }
  if (typeof obj['clientName'] === 'string' || typeof obj['client_name'] === 'string') {
    const v = String(obj['clientName'] ?? obj['client_name'] ?? '').trim().slice(0, 100);
    if (v) ctx.clientName = v;
  }
  return Object.keys(ctx).length > 0 ? ctx : null;
}

export function createKbRagController(service: KbRagCopilotService) {
  return async function kbRagController(req: Request, res: Response): Promise<void> {
    const body = req.body as Record<string, unknown>;
    const rawQuery = String(body['query'] ?? '').trim().slice(0, MAX_QUERY_LENGTH);

    if (rawQuery === '') {
      res.status(400).json({ ok: false, message: 'query é obrigatório.' });
      return;
    }

    const ticketId = intOrNull(body['ticketId'] ?? body['ticket_id']);
    const technicianId = intOrNull(body['technicianId'] ?? body['technician_id']);
    const topK = Math.max(3, Math.min(5, parseInt(String(body['topK'] ?? body['top_k'] ?? '5'), 10) || 5));
    const clientContext = parseClientContext(body['clientContext'] ?? body['client_context']);

    try {
      const result = await service.generatePlaybook({
        query: rawQuery,
        ticketId,
        technicianId,
        topK,
        clientContext,
      });
      res.status(200).json(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, message: `Erro interno: ${message.slice(0, 200)}` });
    }
  };
}
