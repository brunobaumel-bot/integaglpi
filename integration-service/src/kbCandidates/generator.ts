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

// Hard cap on confidence — an evidence-backed candidate should never claim a
// perfect, artificial 100%. Human review is always required.
const CONFIDENCE_HARD_CAP = 92;

interface ConfidenceResult {
  score: number;
  reason: string;
}

function confidenceFor(
  pattern: KbCandidateSourcePattern,
  insight: KbCandidateSourceInsight | undefined,
  evidenceCount: number,
  recurrenceThreshold: number,
): ConfidenceResult {
  const severityBonus = pattern.severity === 'high' ? 18 : pattern.severity === 'medium' ? 10 : 3;
  const priorityBonus = insight?.priority === 'high' ? 14 : insight?.priority === 'medium' ? 8 : 2;
  const frequencyBonus = Math.min(28, pattern.frequencyAbs * 4);
  const insightScore = insight ? Math.round(insight.confidenceScore * 0.25) : 0;
  const evidenceBonus = Math.min(10, evidenceCount * 2);

  let score = 35 + severityBonus + priorityBonus + frequencyBonus + insightScore + evidenceBonus;
  const reasons: string[] = [
    `${pattern.frequencyAbs} ocorrência(s) recorrentes`,
    `severidade ${pattern.severity}`,
  ];

  // Realism penalties: without evidence or confirmed cause, the score is capped.
  if (evidenceCount === 0) {
    score = Math.min(score, 60);
    reasons.push('sem evidência anonimizada vinculada (teto 60)');
  } else {
    reasons.push(`${evidenceCount} evidência(s) anonimizada(s)`);
  }
  if (pattern.frequencyAbs < recurrenceThreshold) {
    score = Math.min(score, 55);
    reasons.push(`abaixo do limiar de recorrência (${recurrenceThreshold}) → teto 55`);
  }
  if (!insight) {
    reasons.push('sem insight de suporte');
  }

  // Never artificial 100%.
  score = clamp(score, 0, CONFIDENCE_HARD_CAP);
  reasons.push('revisão humana obrigatória');

  return {
    score,
    reason: `Score ${score}: ${reasons.join('; ')}.`,
  };
}

/**
 * Build a SPECIFIC title from the problem signature, not just the category.
 * Generic category-only titles ("Hardware", "FAQ interno") are what made the
 * old candidates useless; here we combine an action verb (by article type) with
 * the system/category AND a short, distinctive descriptor pulled from the
 * sanitized pattern description.
 */
function titleFor(
  type: KbCandidateArticleType,
  category: string,
  pattern: KbCandidateSourcePattern,
): string {
  const system = sanitizeHistoricalText(category || 'sistema não identificado', 60);
  const descriptor = distinctiveDescriptor(pattern.descriptionSanitized);
  const subject = descriptor !== '' ? `${system} — ${descriptor}` : system;

  if (type === 'resposta_padrao_humanizada') {
    return `Resposta padrão: ${subject}`;
  }
  if (type === 'checklist_diagnostico') {
    return `Checklist de diagnóstico: ${subject}`;
  }
  if (type === 'pergunta_inicial_recomendada') {
    return `Perguntas iniciais: ${subject}`;
  }
  if (type === 'solucao_comum') {
    return `Solução recorrente: ${subject}`;
  }
  if (type === 'alerta_operacional') {
    return `Alerta operacional: ${subject}`;
  }
  return `Procedimento técnico: ${subject}`;
}

/** Extracts a short distinctive phrase (first 3-6 meaningful tokens) from the description. */
function distinctiveDescriptor(description: string): string {
  const tokens = tokensFor(description).filter((t) => t.length >= 4).slice(0, 6);
  return sanitizeHistoricalText(tokens.join(' '), 70);
}

/** Known generic/low-value labels that must never stand alone as a title. */
const GENERIC_TITLE_TERMS = [
  'hardware', 'software', 'faq interno', 'faq', 'duvidas tecnicas', 'dúvidas técnicas',
  'resposta humanizada', 'atendimento recorrente', 'diversos', 'outros', 'geral',
  'suporte', 'chamado', 'ticket', 'problema',
];

/**
 * A title is "generic" if, after removing the article-type prefix and the system
 * label, nothing distinctive remains — i.e. it is just a bare category word or a
 * known low-value label. Such candidates are rejected, not published as noise.
 */
function isGenericTitle(title: string, pattern: KbCandidateSourcePattern): boolean {
  const normalized = normalizeTokenText(title);
  // No distinctive descriptor was available AND the category itself is generic.
  const hasDescriptor = distinctiveDescriptor(pattern.descriptionSanitized) !== '';
  if (hasDescriptor) {
    return false;
  }
  const categoryNorm = normalizeTokenText(pattern.category);
  if (categoryNorm === '' || GENERIC_TITLE_TERMS.includes(categoryNorm)) {
    return true;
  }
  // If the whole title collapses to a single known-generic term, reject.
  return GENERIC_TITLE_TERMS.some((term) => normalized.endsWith(normalizeTokenText(term)) && categoryNorm.length <= 4);
}

function difficultyFor(pattern: KbCandidateSourcePattern, type: KbCandidateArticleType): 'basico' | 'intermediario' | 'avancado' {
  if (pattern.patternType === 'reopen_hotspot' || pattern.severity === 'high') {
    return 'avancado';
  }
  if (type === 'pergunta_inicial_recomendada' || type === 'resposta_padrao_humanizada') {
    return 'basico';
  }
  return 'intermediario';
}

function targetAudienceFor(type: KbCandidateArticleType, difficulty: 'basico' | 'intermediario' | 'avancado'): string {
  if (difficulty === 'avancado') {
    return 'Técnico N2/N3';
  }
  if (type === 'pergunta_inicial_recomendada' || type === 'resposta_padrao_humanizada') {
    return 'Atendimento N1';
  }
  return 'Técnico N1/N2';
}

function findRelatedNativeArticles(
  title: string,
  category: string,
  nativeArticles: KbCandidateNativeArticle[],
  duplicateThreshold: number,
): {
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

  // Duplicate decision uses the configured similarity threshold (default 0.75).
  const duplicate = scored.find((item) => item.score >= duplicateThreshold);
  return {
    related: scored.map((item) => ({
      articleId: item.article.articleId,
      title: sanitizeHistoricalText(item.article.title, 160),
      category: sanitizeHistoricalText(item.article.category, 80),
      internalUrl: sanitizeHistoricalText(item.article.internalUrl, 240),
      excerpt: sanitizeHistoricalText(item.article.excerpt ?? '', 240),
    })),
    duplicateReason: duplicate
      ? `Possível artigo nativo semelhante (similaridade ${Math.round(duplicate.score * 100)}%): ${sanitizeHistoricalText(duplicate.article.title, 120)}. Considere complementar o artigo existente em vez de criar um novo.`
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

## Resumo executivo
${candidate.problemPattern}

## Público-alvo e dificuldade
- Público-alvo: ${candidate.targetAudience}
- Nível de dificuldade: ${candidate.difficultyLevel}

## Quando usar
- Quando o cenário abaixo (sintomas) for confirmado com o usuário.

## Quando NÃO usar
- Se os sintomas não baterem ou houver indício de causa diferente — revisar antes.

## Quando escalar
- Se o procedimento não resolver após validação, ou houver risco de impacto amplo.

## Sintomas
${symptoms || '- Evidência insuficiente para detalhar sintomas sem revisão humana.'}

## Causa provável
${candidate.probableCause}

## Procedimento técnico (passo a passo)
${procedure || '1. Revisar evidências anonimizadas antes de publicar.'}

## Como validar que resolveu
- [ ] Confirmar com o usuário que o sintoma original cessou.
- [ ] Registrar a solução aplicada no chamado.

## Checklist de diagnóstico
${checklist || '- [ ] Validar contexto com supervisor.'}

## Resposta humanizada sugerida
${candidate.humanizedCustomerResponse}

## Tags sugeridas
${tags || '`revisao-humana`'}

## Categoria GLPI sugerida
${candidate.categorySuggestion || 'A definir na revisão'}

## Confiança (justificativa)
${candidate.confidenceReason}

## Evidências anonimizadas
${candidate.evidenceSummarySanitized}

## Limitações
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
  // Recurrence threshold: default 5; homologação/baixo volume may relax to 3.
  // Recurrence threshold: default 5; the contract permits relaxing only down to 3
  // (homologação / low-volume queues). Values below 3 are normalized up to 3 so a
  // one-off or two-off pattern can never produce a KB candidate.
  const recurrenceThreshold = clamp(options.recurrenceThreshold ?? 5, 3, 100);
  const duplicateThreshold = clamp(options.duplicateSimilarityThreshold ?? 0.75, 0.5, 0.99);
  const nativeArticles = input.nativeArticles ?? [];
  const candidates: GeneratedKbCandidate[] = [];

  for (const pattern of input.patterns) {
    // Recurrence gate — do not generate KB candidates for one-off patterns.
    if (pattern.frequencyAbs < recurrenceThreshold) {
      continue;
    }
    const insight = bestInsightFor(pattern, input.insights);
    const evidence = input.evidence.filter((item) => pattern.evidenceHashes.includes(item.ticketIdHash)).slice(0, 5);
    const evidenceText = evidence.map((item) => item.anonymizedExcerpt).join(' | ');
    if (sourceHasSensitiveContent(pattern, insight, evidenceText)) {
      continue;
    }
    const articleType = candidateTypeFor(pattern, insight);
    const title = titleFor(articleType, pattern.category, pattern);
    // Reject generic, non-reusable titles ("Hardware", "FAQ interno", …).
    if (isGenericTitle(title, pattern)) {
      continue;
    }
    const difficultyLevel = difficultyFor(pattern, articleType);
    const targetAudience = targetAudienceFor(articleType, difficultyLevel);
    const confidence = confidenceFor(pattern, insight, evidence.length, recurrenceThreshold);
    const confidenceScore = confidence.score;
    const dedupe = findRelatedNativeArticles(title, pattern.category, nativeArticles, duplicateThreshold);
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
      confidenceReason: confidence.reason,
      difficultyLevel,
      targetAudience,
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
