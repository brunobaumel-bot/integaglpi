import { createHash } from 'node:crypto';

import { detectSourceConflicts, validateExternalResearchSource } from './sourceValidator.js';
import type {
  ExternalResearchCandidate,
  ExternalResearchSanitizationResult,
  ExternalResearchSourceInput,
  ExternalSourceCatalogEntry,
} from './types.js';

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function safeText(value: string, max = 500): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function isoDatePlus(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function buildExternalResearchCandidate(
  sanitized: ExternalResearchSanitizationResult,
  sources: ExternalResearchSourceInput[],
  catalog: ExternalSourceCatalogEntry[],
): ExternalResearchCandidate {
  const validations = sources.map((source) => ({
    source,
    validation: validateExternalResearchSource(source.url, catalog),
  }));
  const blocked = validations.find((item) => !item.validation.allowed);
  if (blocked) {
    throw new Error(blocked.validation.blockedReason ?? 'EXTERNAL_RESEARCH_SOURCE_BLOCKED');
  }

  const conflicts = detectSourceConflicts(validations.map((item) => item.validation));
  const sourceConfidence = validations.map((item) => item.validation.confidenceScore);
  const averageConfidence = sourceConfidence.length > 0
    ? Math.round(sourceConfidence.reduce((sum, value) => sum + value, 0) / sourceConfidence.length)
    : 0;
  const conflictPenalty = conflicts.length * 12;
  const confidenceScore = Math.max(0, Math.min(100, averageConfidence - conflictPenalty));
  const status = confidenceScore >= 70 ? 'suggested' : 'suggested_low_confidence';
  const lastVerifiedDate = isoDatePlus(0);
  const nextReviewDue = isoDatePlus(90);
  const problemSignature = safeText(sanitized.sanitizedText, 180);
  const title = `Candidato externo: ${problemSignature || 'procedimento técnico'}`.slice(0, 180);
  const externalSources = validations.map((item) => ({
    title: safeText(item.source.title || item.validation.matchedSource?.name || item.source.url, 180),
    url: item.source.url,
    sourceType: item.validation.matchedSource?.sourceType ?? 'low_confidence',
    officialFlag: item.validation.matchedSource?.officialFlag === true,
    confidence: item.validation.confidenceScore,
    lastVerifiedDate,
  }));
  const markdown = [
    `# ${title}`,
    '',
    '## Sintomas sanitizados',
    sanitized.sanitizedText || 'Resumo técnico não informado.',
    '',
    '## Solução proposta para revisão humana',
    'Conferir a documentação citada, validar a versão do produto e adaptar o procedimento ao ambiente antes de publicar na KB nativa.',
    '',
    '## Passos sugeridos',
    '1. Confirmar versão e escopo na fonte oficial.',
    '2. Reproduzir em ambiente controlado quando aplicável.',
    '3. Revisar riscos e pré-requisitos com supervisor.',
    '',
    '## Aviso',
    'Não execute comandos/scripts sem validação técnica humana.',
  ].join('\n');

  return {
    candidateId: hash({ payload: sanitized.anonymizedPayloadHash, sources: externalSources.map((source) => source.url) }).slice(0, 32),
    status,
    problemSignature,
    sanitizedSymptoms: sanitized.sanitizedText,
    likelyCategory: 'Pesquisa externa controlada',
    proposedSolution: 'Validar fontes oficiais e transformar em artigo interno revisado antes de uso operacional.',
    stepByStep: [
      'Priorizar documentação oficial.',
      'Comparar versão, pré-requisitos e riscos.',
      'Criar ou atualizar artigo manualmente na KB nativa somente após revisão.',
    ],
    validationSteps: [
      'Confirmar data da documentação.',
      'Validar em ambiente de teste.',
      'Revisar com supervisor antes da publicação manual.',
    ],
    risks: [
      'Fonte externa pode estar desatualizada.',
      'Comandos ou scripts citados não devem ser executados sem validação humana.',
    ],
    prerequisites: [
      'Permissão de pesquisa externa.',
      'Prompt anonimizado sem PII/segredos.',
      'Fonte cadastrada na allowlist.',
    ],
    externalSources,
    sourceConflicts: conflicts,
    confidenceScore,
    sourceConfidenceLevel: confidenceScore >= 70 ? 'official_or_verified' : 'low_confidence',
    lowConfidenceReason: confidenceScore >= 70 ? null : 'Confiança abaixo de 70 ou conflito de fontes; manter revisão humana reforçada.',
    lastVerifiedDate,
    nextReviewDue,
    humanizedCustomerExplanation: 'Vamos validar a orientação em fonte oficial e adaptar o procedimento antes de aplicar no atendimento.',
    suggestedKbArticle: {
      title,
      contentMarkdown: markdown,
      tags: ['pesquisa-externa', 'revisao-humana'],
      categorySuggestion: 'Pesquisa externa controlada',
    },
    humanReviewRequired: true,
    autoPublish: false,
    inputHash: sanitized.inputHash,
    anonymizedPayloadHash: sanitized.anonymizedPayloadHash,
    sourceCatalogIds: validations
      .map((item) => item.validation.matchedSource?.id ?? 0)
      .filter((id) => id > 0),
  };
}
