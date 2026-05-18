import type { AiQualityContext } from './aiQualityTypes.js';
import { AI_QUALITY_ANALYSIS_VERSION } from './aiQualityTypes.js';
import { sanitizeAiQualityText } from './sanitizeAiQualityInput.js';

export function buildAiQualityPrompt(context: AiQualityContext, maxChars: number): string {
  const knownNames = [context.requesterName];
  const messages = context.messages
    .map((message) => {
      const role = message.direction === 'inbound' ? 'CLIENTE' : 'TECNICO';
      const text = sanitizeAiQualityText(message.messageText, knownNames);
      return `[${message.createdAt.toISOString()}][${role}][${message.messageType}] ${text}`;
    })
    .join('\n')
    .slice(0, maxChars);

  return [
    `template_version=${AI_QUALITY_ANALYSIS_VERSION}`,
    'Você é uma IA supervisora read-only. Não converse com o cliente. Não execute ações. Apenas analise e recomende para supervisor humano.',
    'Todos os dados pessoais já foram mascarados. Se ainda encontrar dado sensível, ignore e não repita.',
    'Responda somente com JSON válido e sem markdown.',
    'Schema obrigatório:',
    '{"summary":"resumo do atendimento em até 100 caracteres","resolution":"resolved|probably_resolved|uncertain|probably_not_resolved","sentiment":"satisfied|neutral|dissatisfied|high_risk","flags":["supervisor_review_required|needs_training|customer_dissatisfied|unclear_resolution|long_delay|poor_tone"],"recommendation":"recomendação para o supervisor em até 200 caracteres"}',
    'Metadados mínimos:',
    JSON.stringify({
      ticket_id: context.glpiTicketId,
      ticket_status: context.ticketStatus,
      csat_rating: context.csatRating,
      supervisor_review_required: context.supervisorReviewRequired,
      inactivity_status: context.inactivityStatus,
    }),
    'Mensagens sanitizadas:',
    messages,
  ].join('\n');
}
