import { sha256Hex, sanitizeHistoricalText, hasObviousSensitiveContent } from '../historicalMining/sanitizer.js';
import type {
  GeneratedKbCandidate,
  KbCandidateArticleType,
  KbCandidateGenerationInput,
  KbCandidateGenerationOptions,
  KbCandidateNativeArticle,
  KbCandidateSourceInsight,
  KbCandidateSourcePattern,
  KbCandidateStatus,
} from './types.js';

const DEFAULT_MIN_CONFIDENCE = 65;
const MAX_TEXT = 1_500;

const STOPWORDS = new Set([
  'para',
  'com',
  'sem',
  'uma',
  'dos',
  'das',
  'que',
  'por',
  'em',
  'de',
  'do',
  'da',
  'os',
  'as',
  'ao',
  'aos',
  'e',
  'o',
  'a',
]);

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function normalizeTokenText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokensFor(value: string): string[] {
  return normalizeTokenText(value)
    .split(' ')
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

function scoreOverlap(left: string, right: string): number {
  const leftTokens = new Set(tokensFor(left));
  const rightTokens = new Set(tokensFor(right));
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  let matches = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      matches++;
    }
  }

  return matches / Math.max(leftTokens.size, rightTokens.size);
}

function candidateTypeFor(pattern: KbCandidateSourcePattern, insight?: KbCandidateSourceInsight): KbCandidateArticleType {
  if (pattern.patternType === 'communication_gap') {
    return 'resposta_padrao_humanizada';
  }
  if (pattern.patternType === 'frustration_signal') {
    return 'pergunta_inicial_recomendada';
  }
  if (pattern.patternType === 'reopen_hotspot') {
    return 'checklist_diagnostico';
  }
  if (insight?.insightType === 'kb_opportunity' || pattern.patternType === 'kb_gap_candidate') {
    return 'procedimento_tecnico';
  }
  if (pattern.patternType === 'solution_effectiveness') {
    return 'solucao_comum';
  }

  return 'faq_interno';
}

function confidenceFor(pattern: KbCandidateSourcePattern, insight?: KbCandidateSourceInsight, evidenceCount = 0): number {
  const severityBonus = pattern.severity === 'high' ? 18 : pattern.severity === 'medium' ? 10 : 3;
  const priorityBonus = insight?.priority === 'high' ? 14 : insight?.priority === 'medium' ? 8 : 2;
  const frequencyBonus = Math.min(28, pattern.frequencyAbs * 4);
  const insightScore = insight ? Math.round(insight.confidenceScore * 0.25) : 0;
  const evidenceBonus = Math.min(10, evidenceCount * 2);

  return clamp(35 + severityBonus + priorityBonus + frequencyBonus + insightScore + evidenceBonus, 0, 100);
}

function titleFor(type: KbCandidateArticleType, category: string): string {
  const label = sanitizeHistoricalText(category || 'Atendimento recorrente', 80);
  if (type === 'resposta_padrao_humanizada') {
    return `Resposta humanizada para ${label}`;
  }
  if (type === 'checklist_diagnostico') {
    return `Checklist de diagnóstico: ${label}`;
  }
  if (type === 'pergunta_inicial_recomendada') {
    return `Perguntas iniciais para ${label}`;
  }
  if (type === 'solucao_comum') {
    return `Solução comum: ${label}`;
  }
  return `Procedimento sugerido: ${label}`;
}

function findRelatedNativeArticles(title: string, category: string, nativeArticles: KbCandidateNativeArticle[]): {
  related: KbCandidateNativeArticle[];
  duplicateReason: string | null;
} {
  const scored = nativeArticles
    .map((article) => ({
      article,
      score: Math.max(
        scoreOverlap(title, article.title),
        scoreOverlap(`${category} ${title}`, `${article.category} ${article.title} ${article.excerpt ?? ''}`),
      ),
    }))
    .filter((item) => item.score >= 0.28)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  const duplicate = scored.find((item) => item.score >= 0.55);
  return {
    related: scored.map((item) => ({
      articleId: item.article.articleId,
      title: sanitizeHistoricalText(item.article.title, 160),
      category: sanitizeHistoricalText(item.article.category, 80),
      internalUrl: sanitizeHistoricalText(item.article.internalUrl, 240),
      excerpt: sanitizeHistoricalText(item.article.excerpt ?? '', 240),
    })),
    duplicateReason: duplicate
      ? `Possivel artigo nativo semelhante: ${sanitizeHistoricalText(duplicate.article.title, 120)}`
      : null,
  };
}

function buildMarkdown(candidate: Omit<GeneratedKbCandidate, 'contentMarkdown'>): string {
  const checklist = candidate.checklistItems.map((item) => `- [ ] ${item}`).join('\n');
  const procedure = candidate.recommendedProcedure.map((item, index) => `${index + 1}. ${item}`).join('\n');
  const symptoms = candidate.symptoms.map((item) => `- ${item}`).join('\n');
  const tags = candidate.tags.map((tag) => `\`${tag}\``).join(', ');

  return sanitizeHistoricalText(`
# ${candidate.title}

## Padrao observado
${candidate.problemPattern}

## Sintomas
${symptoms || '- Evidencia insuficiente para detalhar sintomas sem revisao humana.'}

## Causa provavel
${candidate.probableCause}

## Procedimento recomendado
${procedure || '1. Revisar evidencias anonimizadas antes de publicar.'}

## Checklist
${checklist || '- [ ] Validar contexto com supervisor.'}

## Resposta humanizada sugerida
${candidate.humanizedCustomerResponse}

## Tags sugeridas
${tags || '`revisao-humana`'}

## Evidencias anonimizadas
${candidate.evidenceSummarySanitized}

## Limitacoes
${candidate.limitations.map((item) => `- ${item}`).join('\n')}
`, 6_000);
}

function isSafeCandidate(candidate: GeneratedKbCandidate): boolean {
  return !hasObviousSensitiveContent([
    candidate.title,
    candidate.contentMarkdown,
    candidate.problemPattern,
    candidate.probableCause,
    candidate.humanizedCustomerResponse,
    candidate.evidenceSummarySanitized,
  ].join('\n'));
}

function sourceHasSensitiveContent(
  pattern: KbCandidateSourcePattern,
  insight: KbCandidateSourceInsight | undefined,
  evidenceText: string,
): boolean {
  return hasObviousSensitiveContent([
    pattern.descriptionSanitized,
    pattern.category,
    insight?.title ?? '',
    insight?.summarySanitized ?? '',
    insight?.recommendationSanitized ?? '',
    evidenceText,
  ].join('\n'));
}

function bestInsightFor(pattern: KbCandidateSourcePattern, insights: KbCandidateSourceInsight[]): KbCandidateSourceInsight | undefined {
  const sameCategory = normalizeTokenText(pattern.category);
  return insights.find((insight) => (
    insight.insightType === 'kb_opportunity'
    || insight.insightType === 'communication'
    || insight.insightType === 'reopen'
    || insight.insightType === 'solution_quality'
  ) && scoreOverlap(sameCategory, `${insight.title} ${insight.summarySanitized}`) >= 0.2) ?? insights[0];
}

export function generateKbCandidatesFromHistory(
  input: KbCandidateGenerationInput,
  options: Partial<KbCandidateGenerationOptions> = {},
): GeneratedKbCandidate[] {
  const minConfidence = clamp(options.minConfidence ?? DEFAULT_MIN_CONFIDENCE, 1, 100);
  const maxCandidates = clamp(options.maxCandidates ?? 20, 1, 100);
  const nativeArticles = input.nativeArticles ?? [];
  const candidates: GeneratedKbCandidate[] = [];

  for (const pattern of input.patterns) {
    const insight = bestInsightFor(pattern, input.insights);
    const evidence = input.evidence.filter((item) => pattern.evidenceHashes.includes(item.ticketIdHash)).slice(0, 5);
    const evidenceText = evidence.map((item) => item.anonymizedExcerpt).join(' | ');
    if (sourceHasSensitiveContent(pattern, insight, evidenceText)) {
      continue;
    }
    const articleType = candidateTypeFor(pattern, insight);
    const title = titleFor(articleType, pattern.category);
    const confidenceScore = confidenceFor(pattern, insight, evidence.length);
    const dedupe = findRelatedNativeArticles(title, pattern.category, nativeArticles);
    const possibleDuplicate = dedupe.duplicateReason !== null;
    const status: KbCandidateStatus = possibleDuplicate
      ? 'possible_duplicate'
      : confidenceScore >= minConfidence
        ? 'suggested'
        : 'low_confidence';

    const baseCandidate: Omit<GeneratedKbCandidate, 'contentMarkdown'> = {
      candidateKey: sha256Hex([
        input.runId,
        pattern.id,
        insight?.id ?? 'no-insight',
        title,
        articleType,
      ].join(':')),
      inputHash: input.inputHash,
      status,
      articleType,
      title,
      problemPattern: sanitizeHistoricalText(pattern.descriptionSanitized, 700),
      symptoms: [
        `Ocorrencia recorrente em ${pattern.frequencyAbs} registro(s) historicos sanitizados.`,
        pattern.category ? `Categoria associada: ${sanitizeHistoricalText(pattern.category, 80)}.` : '',
      ].filter(Boolean),
      probableCause: sanitizeHistoricalText(
        pattern.patternType === 'reopen_hotspot'
          ? 'Hipotese: solucao incompleta ou falta de checklist de validacao.'
          : 'Nao identificado com seguranca; revisar evidencias anonimizadas antes de publicar.',
        300,
      ),
      recommendedProcedure: [
        'Confirmar o cenario com o usuario e registrar sintomas objetivos.',
        sanitizeHistoricalText(insight?.recommendationSanitized ?? 'Comparar com procedimentos existentes na KB nativa.', 300),
        'Validar a solucao com supervisor antes de publicar na Base GLPI nativa.',
      ],
      checklistItems: [
        'Validar categoria, fila e impacto.',
        'Checar se ja existe artigo nativo equivalente.',
        'Confirmar que a resposta nao contem dados pessoais ou credenciais.',
      ],
      humanizedCustomerResponse: sanitizeHistoricalText(
        'Obrigado pelas informacoes. Vou revisar os detalhes do caso e seguir o procedimento adequado. Se precisar, peco mais dados antes de orientar a proxima etapa.',
        500,
      ),
      tags: Array.from(new Set([
        normalizeTokenText(pattern.category).replace(/\s+/g, '-').slice(0, 40),
        pattern.patternType.replace(/_/g, '-'),
        articleType.replace(/_/g, '-'),
      ].filter(Boolean))).slice(0, 8),
      categorySuggestion: sanitizeHistoricalText(pattern.category, 120),
      relatedNativeKbArticles: dedupe.related,
      possibleDuplicate,
      duplicateReason: dedupe.duplicateReason,
      sourcePatternIds: [pattern.id],
      sourceInsightIds: insight ? [insight.id] : [],
      evidenceSummarySanitized: sanitizeHistoricalText(
        evidenceText || pattern.descriptionSanitized,
        MAX_TEXT,
      ),
      evidenceHashes: pattern.evidenceHashes.slice(0, 10),
      confidenceScore,
      limitations: [
        'Gerado somente a partir de dados historicos sanitizados da P2.',
        'Revisao humana obrigatoria antes de qualquer uso ou publicacao manual.',
        'Nao publica nem altera a Base de Conhecimento nativa automaticamente.',
      ],
    };
    const candidate: GeneratedKbCandidate = {
      ...baseCandidate,
      contentMarkdown: buildMarkdown(baseCandidate),
    };

    if (isSafeCandidate(candidate)) {
      candidates.push(candidate);
    }
  }

  return candidates
    .sort((a, b) => b.confidenceScore - a.confidenceScore)
    .slice(0, maxCandidates);
}
