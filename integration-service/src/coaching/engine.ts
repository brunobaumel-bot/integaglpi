import { createHash } from 'node:crypto';

import {
  COACHING_RECOMMENDATION_VERSION,
  type CoachingKbArticle,
  type CoachingOnboardingPlan,
  type CoachingRecommendation,
  type CoachingRecommendationType,
  type CoachingSignalInput,
} from './types.js';

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function safeText(value: string, max = 500): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\b(?:\+?\d[\d .()-]{7,}\d)\b/g, '[telefone]')
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, '[documento]')
    .replace(/\b(password|senha|token|bearer|api[_-]?key|app[_-]?secret)\s*[:=]\s*[^,\s]+/gi, '$1=[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function onboardingPlan(topic: string): CoachingOnboardingPlan {
  return {
    day7: [
      `Ler artigos essenciais da KB sobre ${topic}.`,
      'Observar atendimentos revisados por supervisor e registrar dúvidas.',
      'Usar checklist básico antes de responder clientes.',
    ],
    day15: [
      'Praticar respostas claras e empáticas com revisão humana.',
      'Revisar casos recorrentes e comparar com a KB nativa.',
      'Mapear lacunas sem criar ação automática.',
    ],
    day30: [
      'Fazer revisão construtiva com supervisor.',
      'Atualizar plano de estudo conforme feedback recebido.',
      'Sugerir melhoria de KB para curadoria humana quando necessário.',
    ],
  };
}

function relatedArticles(input: CoachingSignalInput): CoachingKbArticle[] {
  return (input.relatedKbArticles ?? []).slice(0, 5).map((article) => ({
    articleId: Number(article.articleId),
    title: safeText(article.title, 180),
    category: safeText(article.category, 120),
    internalUrl: safeText(article.internalUrl, 300),
  })).filter((article) => Number.isInteger(article.articleId) && article.articleId > 0);
}

function makeRecommendation(
  input: CoachingSignalInput,
  recommendationType: CoachingRecommendationType,
  title: string,
  summary: string,
  explanation: string,
  actions: string[],
  confidence: number,
  topic: string,
): CoachingRecommendation {
  const inputHash = input.inputHash ?? hash(input);
  const scopeHash = hash(`${input.scopeType}:${input.scopeLabel}`);
  const key = hash(`${COACHING_RECOMMENDATION_VERSION}:${inputHash}:${input.scopeType}:${recommendationType}:${title}`);
  return {
    recommendationId: key.slice(0, 32),
    recommendationKey: key,
    scopeType: input.scopeType,
    scopeHash,
    recommendationType,
    title: safeText(title, 180),
    summarySanitized: safeText(summary, 700),
    explanationSanitized: safeText(explanation, 900),
    suggestedActions: actions.map((action) => safeText(action, 240)).filter(Boolean).slice(0, 6),
    kbArticles: relatedArticles(input),
    onboardingPlan: onboardingPlan(topic),
    confidenceScore: clamp(confidence),
    inputHash,
    recommendationVersion: COACHING_RECOMMENDATION_VERSION,
    status: 'active',
  };
}

export function generateCoachingRecommendations(input: CoachingSignalInput): CoachingRecommendation[] {
  const recommendations: CoachingRecommendation[] = [];
  const sampleSize = Number(input.aiAnalysisCount ?? 0);
  const scope = safeText(input.scopeLabel || input.scopeType, 120);

  if (sampleSize < 5) {
    recommendations.push(makeRecommendation(
      input,
      'data_quality_warning',
      `Coletar mais amostras para ${scope}`,
      'Amostra pequena para conclusão de coaching. Use esta recomendação apenas como alerta fraco.',
      'Dados insuficientes reduzem a confiança e impedem julgamento individual ou comparativo.',
      [
        'Acompanhar mais atendimentos antes de concluir lacunas de habilidade.',
        'Usar feedback humano para calibrar futuras recomendações.',
        'Evitar qualquer decisão disciplinar baseada nesta amostra.',
      ],
      35,
      'qualidade de dados',
    ));
  }

  if ((input.averageClarity ?? 10) <= 6) {
    recommendations.push(makeRecommendation(
      input,
      'communication_skill',
      `Trilha de comunicação clara para ${scope}`,
      'A média de clareza indica oportunidade de melhorar orientação, próximos passos e confirmação de entendimento.',
      'A regra foi acionada por baixa clareza agregada em análises IA persistidas, sem usar texto bruto.',
      [
        'Revisar exemplos de respostas objetivas antes de enviar mensagens.',
        'Usar frases curtas com próximo passo explícito.',
        'Confirmar dados ausentes antes de concluir o atendimento.',
      ],
      72,
      'comunicação clara',
    ));
  }

  if ((input.averageEmpathy ?? 10) <= 6) {
    recommendations.push(makeRecommendation(
      input,
      'training_path',
      `Atendimento humanizado para ${scope}`,
      'Há oportunidade de reforçar acolhimento, tom profissional e empatia nas respostas.',
      'A regra usa apenas métricas agregadas de empatia da IA Supervisora, sem ranking individual.',
      [
        'Praticar abertura de resposta reconhecendo o problema do cliente.',
        'Evitar respostas frias ou defensivas.',
        'Solicitar revisão de um supervisor em casos sensíveis.',
      ],
      70,
      'atendimento humanizado',
    ));
  }

  if ((input.averageCompleteness ?? 10) <= 6 || (input.procedureNotFollowedCount ?? 0) > 0) {
    recommendations.push(makeRecommendation(
      input,
      'coaching_session_tip',
      `Checklist de completude para ${scope}`,
      'Sinais agregados sugerem respostas incompletas ou procedimento não seguido.',
      'A recomendação é de coaching de processo e deve ser revisada por supervisor.',
      [
        'Usar checklist antes de encerrar ou responder casos recorrentes.',
        'Conferir se a orientação cobre causa, ação e confirmação com o cliente.',
        'Registrar lacunas de procedimento para curadoria futura.',
      ],
      68,
      'checklist de atendimento',
    ));
  }

  if ((input.kbNotAlignedCount ?? 0) > 0 || (input.kbNoArticleFoundCount ?? 0) > 0) {
    recommendations.push(makeRecommendation(
      input,
      'kb_study_suggestion',
      `Estudo guiado de KB para ${scope}`,
      'Aderência à KB pode ser reforçada com estudo dos artigos nativos relacionados e revisão das exceções.',
      'A regra foi acionada por desalinhamento ou ausência de artigo em análises P1 persistidas.',
      [
        'Revisar artigos nativos sugeridos antes do próximo atendimento semelhante.',
        'Anotar exceções reais para revisão humana da KB.',
        'Não usar artigo como verdade absoluta quando o caso tiver ambiguidade.',
      ],
      74,
      'Base de Conhecimento GLPI',
    ));
  }

  if ((input.pendingKbCandidatesCount ?? 0) > 0) {
    recommendations.push(makeRecommendation(
      input,
      'kb_review_recommendation',
      `Curadoria de candidatos KB para ${scope}`,
      'Existem candidatos de KB pendentes que podem reduzir retrabalho após revisão humana.',
      'A recomendação consome apenas metadados persistidos da P3 e não publica nada na KB nativa.',
      [
        'Revisar candidatos pendentes com maior confiança.',
        'Comparar com artigos nativos antes de criar conteúdo manualmente.',
        'Registrar rejeição quando o candidato não for útil.',
      ],
      76,
      'curadoria de KB',
    ));
  }

  if ((input.highRiskScoreCount ?? 0) > 0 || (input.highSatisfactionRiskCount ?? 0) > 0) {
    recommendations.push(makeRecommendation(
      input,
      'process_improvement',
      `Coaching de risco e satisfação para ${scope}`,
      'Há sinais agregados de risco elevado que merecem revisão construtiva do processo.',
      'A recomendação é explicável e não altera prioridade, status ou ticket.',
      [
        'Revisar motivos recorrentes de risco com foco em prevenção.',
        'Acompanhar próximos casos com feedback humano.',
        'Usar o indicador apenas para melhoria contínua, nunca punição automática.',
      ],
      73,
      'risco e satisfação',
    ));
  }

  if (recommendations.length === 0) {
    recommendations.push(makeRecommendation(
      input,
      'onboarding_plan',
      `Plano 7/15/30 dias para ${scope}`,
      'Não há lacuna forte no recorte atual; manter plano de onboarding preventivo.',
      'Plano gerado por regra determinística para apoiar melhoria contínua sem ranking.',
      [
        'Executar o plano 7/15/30 com revisão humana.',
        'Coletar feedback de supervisores e técnicos.',
        'Revisar aderência à KB no fim do ciclo.',
      ],
      60,
      'onboarding preventivo',
    ));
  }

  return recommendations.slice(0, 8);
}
