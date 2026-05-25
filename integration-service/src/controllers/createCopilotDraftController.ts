import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

import { COPILOT_TONES, COPILOT_WINDOW_NOTICES, type CopilotContext, type CopilotTone } from '../ai/copilotTypes.js';
import type { CopilotDraftService } from '../domain/services/CopilotDraftService.js';
import { logger } from '../infra/logger/logger.js';

function safeString(value: unknown, max: number): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizeTone(value: unknown): CopilotTone {
  return COPILOT_TONES.includes(value as CopilotTone) ? value as CopilotTone : 'neutral';
}

function normalizeContext(value: unknown): CopilotContext {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('COPILOT_INVALID_CONTEXT');
  }

  const record = value as Record<string, unknown>;
  const conversationId = safeString(record.conversation_id ?? record.conversationId, 80);
  const glpiTicketId = Number(record.glpi_ticket_id ?? record.glpiTicketId);
  if (conversationId === '' || !Number.isInteger(glpiTicketId) || glpiTicketId <= 0) {
    throw new Error('COPILOT_INVALID_CONTEXT');
  }

  const windowNotice = COPILOT_WINDOW_NOTICES.includes(record.window_notice as never)
    ? record.window_notice as CopilotContext['windowNotice']
    : 'unknown';
  const rawMessages: unknown[] = Array.isArray(record.messages) ? record.messages : [];
  const rawKbArticlesValue = record.kb_articles ?? record.kbArticles;
  const rawKbArticles: unknown[] = Array.isArray(rawKbArticlesValue) ? rawKbArticlesValue : [];

  return {
    conversationId,
    glpiTicketId,
    ticketTitle: safeString(record.ticket_title ?? record.ticketTitle, 180),
    ticketStatus: safeString(record.ticket_status ?? record.ticketStatus, 80),
    queueName: safeString(record.queue_name ?? record.queueName, 120),
    slaLabel: safeString(record.sla_label ?? record.slaLabel, 120),
    windowNotice,
    messages: rawMessages.slice(-12).map((item) => {
      const message = item !== null && typeof item === 'object' && !Array.isArray(item)
        ? item as Record<string, unknown>
        : {};
      return {
        direction: safeString(message.direction, 20),
        messageType: safeString(message.message_type ?? message.messageType, 40),
        text: safeString(message.text, 600),
        createdAt: safeString(message.created_at ?? message.createdAt, 40),
      };
    }),
    kbArticles: rawKbArticles.slice(0, 5).map((item) => {
      const article = item !== null && typeof item === 'object' && !Array.isArray(item)
        ? item as Record<string, unknown>
        : {};
      return {
        articleId: Number(article.article_id ?? article.articleId ?? 0),
        title: safeString(article.title, 180),
        category: safeString(article.category, 120),
        excerpt: safeString(article.excerpt, 800),
        internalUrl: safeString(article.internal_url ?? article.internalUrl, 300),
      };
    }).filter((article) => Number.isInteger(article.articleId) && article.articleId > 0),
    aiQuality: record.ai_quality && typeof record.ai_quality === 'object' && !Array.isArray(record.ai_quality)
      ? record.ai_quality as Record<string, unknown>
      : null,
    kbCandidates: Array.isArray(record.kb_candidates) ? record.kb_candidates.slice(0, 5) as Record<string, unknown>[] : [],
    historicalInsights: Array.isArray(record.historical_insights) ? record.historical_insights.slice(0, 5) as Record<string, unknown>[] : [],
  };
}

function payloadSize(req: Request): number {
  const contentLength = Number(req.headers['content-length'] ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 0) {
    return contentLength;
  }

  try {
    return Buffer.byteLength(JSON.stringify(req.body ?? {}), 'utf8');
  } catch {
    return 0;
  }
}

function classifyCopilotError(error: unknown): { code: string; status: number; errorType: string } {
  const message = error instanceof Error ? error.message : 'COPILOT_DRAFT_FAILED';
  const normalized = message.toLowerCase();
  if (message === 'COPILOT_DISABLED') {
    return { code: 'COPILOT_DISABLED', status: 503, errorType: 'disabled' };
  }
  if (normalized.includes('aborted') || normalized.includes('timeout') || normalized.includes('timed out')) {
    return { code: 'COPILOT_PROVIDER_TIMEOUT', status: 504, errorType: 'timeout' };
  }
  if (normalized.includes('fetch failed') || normalized.includes('econnrefused') || /^COPILOT_OLLAMA_HTTP_/i.test(message)) {
    return { code: 'COPILOT_PROVIDER_UNAVAILABLE', status: 503, errorType: 'provider_unavailable' };
  }
  if (/COPILOT_DRAFT_(INVALID_JSON|INVALID_SHAPE|INVALID_ENUM|EMPTY)/.test(message)) {
    return { code: 'COPILOT_DRAFT_INVALID_JSON', status: 502, errorType: 'invalid_provider_response' };
  }

  return { code: message || 'COPILOT_DRAFT_FAILED', status: 400, errorType: 'validation' };
}

export function createCopilotDraftController(service: CopilotDraftService) {
  return async (req: Request, res: Response): Promise<void> => {
    const startedAt = Date.now();
    const requestId = randomUUID();
    const size = payloadSize(req);
    try {
      const body = req.body as Record<string, unknown>;
      const action = safeString(body.action, 40) || 'generate';
      const conversationId = safeString(body.conversation_id ?? body.conversationId, 80);
      const glpiTicketId = Number(body.glpi_ticket_id ?? body.glpiTicketId);
      const userId = body.glpi_user_id === null || body.glpi_user_id === undefined ? null : Number(body.glpi_user_id);

      if (action === 'generate') {
        const result = await service.requestDraft({
          context: normalizeContext(body.context),
          tone: normalizeTone(body.tone),
          requestedBy: Number.isFinite(userId) ? userId : null,
        });
        logger.info({
          request_id: requestId,
          elapsed_ms: Date.now() - startedAt,
          payload_size: size,
          provider_mode: 'copilot',
          error_type: 'none',
        }, '[integration-service][copilot][draft_generated]');
        res.status(201).json({ ok: true, draft: result });
        return;
      }

      if (!Number.isInteger(glpiTicketId) || glpiTicketId <= 0 || conversationId === '') {
        res.status(400).json({ ok: false, message: 'COPILOT_INVALID_CONTEXT' });
        return;
      }

      if (action === 'use' || action === 'discard') {
        await service.recordUsage(action === 'use' ? 'COPILOT_DRAFT_USED' : 'COPILOT_DRAFT_DISCARDED', {
          conversationId,
          glpiTicketId,
          draftHash: safeString(body.draft_hash ?? body.draftHash, 80),
          userId: Number.isFinite(userId) ? userId : null,
        });
        res.json({ ok: true });
        return;
      }

      if (action === 'feedback') {
        const feedback = body.feedback === 'not_useful' ? 'not_useful' : 'useful';
        await service.recordFeedback({
          conversationId,
          glpiTicketId,
          draftHash: safeString(body.draft_hash ?? body.draftHash, 80),
          feedback,
          notes: safeString(body.notes, 500),
          userId: Number.isFinite(userId) ? userId : null,
        });
        res.json({ ok: true });
        return;
      }

      res.status(400).json({ ok: false, message: 'COPILOT_INVALID_ACTION' });
    } catch (error: unknown) {
      const classified = classifyCopilotError(error);
      logger.warn({
        request_id: requestId,
        elapsed_ms: Date.now() - startedAt,
        payload_size: size,
        provider_mode: 'copilot',
        error_type: classified.errorType,
      }, '[integration-service][copilot][draft_failed]');
      res.status(classified.status).json({ ok: false, message: classified.code, error_type: classified.errorType });
    }
  };
}
