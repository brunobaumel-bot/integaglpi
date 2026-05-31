import {
  COPILOT_DRAFT_VERSION,
  type CopilotContext,
  type CopilotTone,
} from './copilotTypes.js';
import { sanitizeAiQualityText } from './sanitizeAiQualityInput.js';

function safe(value: unknown, max = 200): string {
  return sanitizeAiQualityText(String(value ?? '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function buildCopilotDraftPrompt(context: CopilotContext, tone: CopilotTone, maxChars: number): string {
  const contextJson = JSON.stringify({
    conversation_id: context.conversationId,
    glpi_ticket_id: context.glpiTicketId,
    ticket_title: safe(context.ticketTitle, 180),
    ticket_status: safe(context.ticketStatus, 80),
    queue: safe(context.queueName, 120),
    sla: safe(context.slaLabel, 120),
    window_notice: context.windowNotice,
    messages: context.messages.slice(-5).map((message) => ({
      direction: safe(message.direction, 20),
      message_type: safe(message.messageType, 40),
      text: safe(message.text, 360),
      created_at: safe(message.createdAt, 40),
    })),
    kb_articles: context.kbArticles.slice(0, 3).map((article) => ({
      article_id: article.articleId,
      title: safe(article.title, 180),
      category: safe(article.category, 120),
      excerpt: safe(article.excerpt, 500),
      internal_url: safe(article.internalUrl, 300),
    })),
    ai_quality: context.aiQuality ?? null,
    kb_candidates: context.kbCandidates.slice(0, 3),
    historical_insights: context.historicalInsights.slice(0, 3),
  }).slice(0, maxChars);

  return [
    `template_version=${COPILOT_DRAFT_VERSION}`,
    'Você é um Copiloto interno para técnico de suporte. Gere apenas um rascunho de resposta editável.',
    'Não envie WhatsApp. Não acione template Meta. Não altere ticket. Não altere KB. Não execute ações.',
    'Use tom humano, claro e objetivo. Não prometa o que o sistema não executa.',
    'Não exponha telefone, e-mail, CPF/CNPJ, tokens, senhas, chaves, links temporários ou dados sensíveis.',
    'Use a Base de Conhecimento GLPI somente como referência quando houver artigo no contexto. Não invente artigo.',
    'Se a janela 24h estiver fechada, mantenha o rascunho útil, mas inclua template_notice exatamente: "A janela de atendimento está fechada. Você precisará usar um template aprovado."',
    `Tom solicitado: ${tone}.`,
    'Responda somente JSON válido, sem markdown.',
    'Schema obrigatório:',
    '{"draft_response":"até 2000 caracteres","tone":"friendly|technical|neutral|concise","kb_references":[{"article_id":1,"title":"título","internal_url":"/front/knowbaseitem.form.php?id=1"}],"assumptions":["hipóteses"],"missing_information":["dados faltantes"],"safety_warnings":["cuidados"],"technician_checklist":["itens para revisar antes de enviar"],"confidence_score":0,"window_notice":"open_24h|closed_24h|unknown","template_notice":"","no_auto_send":true}',
    'Contexto sanitizado:',
    contextJson,
  ].join('\n');
}
