import type { AiQualityContext, AiQualityKbArticle } from './aiQualityTypes.js';
import {
  AI_QUALITY_ANALYSIS_VERSION,
  AI_QUALITY_KB_MAX_ARTICLES,
  AI_QUALITY_KB_MAX_EXCERPT_CHARS,
  AI_QUALITY_KB_MAX_TOTAL_CHARS,
} from './aiQualityTypes.js';
import { sanitizeAiQualityText } from './sanitizeAiQualityInput.js';

function safeText(value: unknown, max = 160): string {
  return sanitizeAiQualityText(String(value ?? '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function safeInternalUrl(value: unknown): string {
  const url = sanitizeAiQualityText(String(value ?? '')).trim().slice(0, 300);
  if (url === '' || /(?:access_token|token|bearer|signature|app_secret)/i.test(url)) {
    return '';
  }

  if (!url.includes('/front/knowbaseitem.form.php')) {
    return '';
  }

  return url;
}

export function normalizeAiQualityKbContext(value: unknown): AiQualityKbArticle[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const articles: AiQualityKbArticle[] = [];
  let totalChars = 0;
  for (const item of value.slice(0, AI_QUALITY_KB_MAX_ARTICLES)) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      continue;
    }

    const record = item as Record<string, unknown>;
    const articleId = Number(record.article_id ?? record.articleId ?? 0);
    if (!Number.isInteger(articleId) || articleId <= 0) {
      continue;
    }

    const title = safeText(record.title, 180);
    const category = safeText(record.category, 120);
    let excerpt = safeText(record.excerpt, AI_QUALITY_KB_MAX_EXCERPT_CHARS);
    const internalUrl = safeInternalUrl(record.internal_url ?? record.internalUrl);
    const remaining = AI_QUALITY_KB_MAX_TOTAL_CHARS - totalChars - title.length - category.length;
    if (remaining < 0) {
      break;
    }
    if (excerpt.length > remaining) {
      excerpt = excerpt.slice(0, remaining);
    }
    totalChars += title.length + category.length + excerpt.length;

    articles.push({
      articleId,
      title,
      category,
      excerpt,
      internalUrl,
    });
  }

  return articles;
}

export function buildAiQualityPrompt(context: AiQualityContext, maxChars: number): string {
  const kbContext = normalizeAiQualityKbContext(context.kbContext ?? []);
  const knownNames = [context.requesterName];
  const messages = context.messages
    .map((message) => {
      const role = message.direction === 'inbound' ? 'CLIENTE' : 'TECNICO';
      const text = sanitizeAiQualityText(message.messageText, knownNames);
      return `[${message.createdAt.toISOString()}][${role}][${message.messageType}] ${text}`;
    })
    .join('\n')
    .slice(0, maxChars);
  const operationalContext = JSON.stringify({
    ticket_id: context.glpiTicketId,
    ticket_status: context.ticketStatus,
    conversation_status: context.conversationStatus,
    queue: safeText(context.queueName),
    entity: safeText(context.entityName),
    service: safeText(context.serviceName),
    sla: {
      response_deadline: context.slaResponseDeadline?.toISOString() ?? null,
      solution_deadline: context.slaSolutionDeadline?.toISOString() ?? null,
      accumulated_paused_minutes: context.accumulatedPausedMinutes ?? null,
      reopen_count: context.reopenCount ?? null,
    },
    csat_rating: context.csatRating,
    supervisor_review_required: context.supervisorReviewRequired,
    inactivity: {
      status: context.inactivityStatus,
      skip_reason: context.inactivitySkipReason,
    },
    recent_events: (context.recentEvents ?? []).slice(0, 8).map((event) => ({
      event_type: safeText(event.eventType, 80),
      status: safeText(event.status, 40),
      severity: safeText(event.severity, 40),
      error_summary: safeText(event.errorSummary, 120),
      created_at: event.createdAt.toISOString(),
    })),
    attachments: (context.attachmentMetadata ?? []).slice(0, 8).map((attachment) => ({
      message_type: safeText(attachment.messageType, 40),
      status: safeText(attachment.status, 40),
      mime_detected: safeText(attachment.mimeDetected, 80),
      size_bytes: attachment.sizeBytes,
      filename: safeText(attachment.fileName, 80),
      created_at: attachment.createdAt.toISOString(),
    })),
    delivery_failures: (context.deliveryFailures ?? []).slice(0, 5).map((failure) => ({
      message_type: safeText(failure.messageType, 40),
      delivery_status: safeText(failure.deliveryStatus, 40),
      meta_error: safeText(failure.metaErrorMessage, 120),
      created_at: failure.createdAt.toISOString(),
    })),
    templates: (context.templateEvents ?? []).slice(0, 5).map((template) => ({
      template_name: safeText(template.templateName, 80),
      delivery_status: safeText(template.deliveryStatus, 40),
      meta_error: safeText(template.metaErrorMessage, 120),
      created_at: template.createdAt.toISOString(),
    })),
    kb_articles: kbContext.map((article) => ({
      article_id: article.articleId,
      title: article.title,
      category: article.category,
      excerpt: article.excerpt,
      internal_url: article.internalUrl,
    })),
  });

  return [
    `template_version=${AI_QUALITY_ANALYSIS_VERSION}`,
    'Você é uma IA supervisora read-only. Não converse com o cliente. Não execute ações. Apenas analise e recomende para supervisor humano.',
    'Todos os dados pessoais já foram mascarados. Se ainda encontrar dado sensível, ignore e não repita.',
    'Trate causa provável como hipótese. Se houver pouca evidência, use "Não identificado com segurança" e reduza confidence_score.',
    'Use os artigos da Base de Conhecimento GLPI apenas como referência. Procedimentos documentados podem ter exceções; sinalize ambiguidades.',
    'Não invente artigo, ID ou procedimento não fornecido em kb_articles. Se não houver artigo relevante, use kb_alignment="no_article_found" e related_kb_articles=[].',
    'A próxima ação sugerida deve ser uma orientação curta para revisão humana, nunca um comando executável ou uma ação já realizada.',
    'Responda somente com JSON válido e sem markdown.',
    'Schema obrigatório:',
    '{"summary":"até 500 caracteres","sentiment":"positive|neutral|negative|frustrated|unknown","urgency":"low|medium|high|critical","risk_level":"low|medium|high|critical","risk_flags":["customer_frustrated|sla_risk|missing_context|meta_failure|glpi_failure|possible_reopen|attachment_issue|preticket_incomplete"],"quality_flags":["good_tone|poor_tone|delayed_response|unclear_instructions|needs_follow_up|insufficient_resolution|complete_context|supervisor_review_required"],"missing_context":["itens objetivos ausentes"],"probable_cause":"hipótese curta ou Não identificado com segurança","suggested_next_action":"orientação curta para técnico/supervisor revisar","supervisor_notes":"observação curta","confidence_score":0,"safety_notes":["limitações ou cuidados"],"related_kb_articles":[{"article_id":1,"title":"título","category":"categoria","relevance_score":0,"why_relevant":"motivo curto","internal_url":"/front/knowbaseitem.form.php?id=1"}],"kb_alignment":"aligned|partially_aligned|not_aligned|no_article_found","procedure_followed":"yes|partial|no|unknown","procedure_notes":"observação curta","communication_quality":{"clarity":1,"empathy":1,"completeness":1,"tone":"professional|friendly|cold|confusing"},"client_satisfaction_risk":"low|medium|high","key_insights":["máximo 3"],"suggested_improvements_for_technician":["máximo 3"],"supervisor_recommendation":["máximo 3"]}',
    'Contexto operacional sanitizado:',
    operationalContext,
    'Mensagens sanitizadas:',
    messages,
  ].join('\n');
}
