import { randomUUID } from 'node:crypto';

import { sanitizeHistoricalText } from './sanitizer.js';
import type {
  HistoricalMiningDataset,
  HistoricalMiningEvidence,
  HistoricalMiningInsight,
  HistoricalMiningPattern,
  HistoricalMiningResult,
  HistoricalTicketRecord,
} from './types.js';

export interface HistoricalMiningAnalyzeOptions {
  windowStart?: Date;
  windowEnd?: Date;
}

const FRUSTRATION_WORDS = [
  'absurdo',
  'demora',
  'insatisfeito',
  'reclama',
  'urgente',
  'parado',
  'sem retorno',
  'não funciona',
  'nao funciona',
  'problema novamente',
];

const COMMUNICATION_GAP_WORDS = [
  'não entendi',
  'nao entendi',
  'confuso',
  'sem detalhes',
  'qualquer coisa',
  'talvez',
  'verificar depois',
  'aguardando retorno',
];

function groupBy<T>(items: T[], keyFactory: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFactory(item) || 'Sem categoria';
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
}

function combinedText(record: HistoricalTicketRecord): string {
  return [
    record.titleText,
    record.descriptionText,
    record.followupText,
    record.solutionText,
  ].join(' ').toLowerCase();
}

function evidenceFor(records: HistoricalTicketRecord[], patternType?: HistoricalMiningPattern['patternType']): HistoricalMiningEvidence[] {
  return records.slice(0, 5).map((record) => ({
    ticketIdHash: record.ticketIdHash,
    patternType,
    anonymizedExcerpt: sanitizeHistoricalText(
      [record.titleText, record.descriptionText, record.followupText, record.solutionText]
        .filter(Boolean)
        .join(' | '),
      240,
    ),
  }));
}

function severityFor(count: number, total: number): HistoricalMiningPattern['severity'] {
  const ratio = total > 0 ? count / total : 0;
  if (count >= 10 || ratio >= 0.4) {
    return 'high';
  }
  if (count >= 4 || ratio >= 0.2) {
    return 'medium';
  }
  return 'low';
}

function avgHoursToSolution(records: HistoricalTicketRecord[]): number | null {
  const durations = records
    .filter((record) => record.solvedAt !== null)
    .map((record) => ((record.solvedAt as Date).getTime() - record.openedAt.getTime()) / 3_600_000)
    .filter((hours) => Number.isFinite(hours) && hours >= 0);
  if (!durations.length) {
    return null;
  }
  return Math.round((durations.reduce((sum, value) => sum + value, 0) / durations.length) * 10) / 10;
}

function hasAnyWord(text: string, words: string[]): boolean {
  return words.some((word) => text.includes(word));
}

function insight(
  insightType: HistoricalMiningInsight['insightType'],
  priority: HistoricalMiningInsight['priority'],
  title: string,
  summary: string,
  recommendation: string,
  confidenceScore: number,
  filters: Record<string, unknown> = {},
): HistoricalMiningInsight {
  return {
    insightType,
    priority,
    title: sanitizeHistoricalText(title, 160),
    summarySanitized: sanitizeHistoricalText(summary, 700),
    recommendationSanitized: sanitizeHistoricalText(recommendation, 500),
    confidenceScore: Math.max(0, Math.min(100, Math.round(confidenceScore))),
    filters,
  };
}

export function analyzeHistoricalMiningDataset(
  dataset: HistoricalMiningDataset,
  options: HistoricalMiningAnalyzeOptions = {},
): HistoricalMiningResult {
  const runId = randomUUID();
  const records = dataset.records;
  const patterns: HistoricalMiningPattern[] = [];
  const evidence: HistoricalMiningEvidence[] = [];
  const insights: HistoricalMiningInsight[] = [];
  const total = records.length;

  const categoryGroups = groupBy(records, (record) => record.category);
  for (const [category, items] of [...categoryGroups.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 8)) {
    if (items.length < 2) {
      continue;
    }
    patterns.push({
      patternType: 'recurring_category',
      category,
      entityLabelSanitized: null,
      frequencyAbs: items.length,
      severity: severityFor(items.length, total),
      descriptionSanitized: sanitizeHistoricalText(`Categoria recorrente em ${items.length} chamados no dataset offline.`),
      evidenceHashes: items.slice(0, 5).map((record) => record.ticketIdHash),
    });
    evidence.push(...evidenceFor(items, 'recurring_category'));
  }

  const reopened = records.filter((record) => record.reopenedCount > 0);
  if (reopened.length > 0) {
    patterns.push({
      patternType: 'reopen_hotspot',
      category: 'Reabertura',
      entityLabelSanitized: null,
      frequencyAbs: reopened.length,
      severity: severityFor(reopened.length, total),
      descriptionSanitized: sanitizeHistoricalText('Chamados com sinal de reabertura indicam retrabalho ou solução incompleta.'),
      evidenceHashes: reopened.slice(0, 5).map((record) => record.ticketIdHash),
    });
    evidence.push(...evidenceFor(reopened, 'reopen_hotspot'));
  }

  const frustration = records.filter((record) => hasAnyWord(combinedText(record), FRUSTRATION_WORDS));
  if (frustration.length > 0) {
    patterns.push({
      patternType: 'frustration_signal',
      category: 'Satisfacao',
      entityLabelSanitized: null,
      frequencyAbs: frustration.length,
      severity: severityFor(frustration.length, total),
      descriptionSanitized: sanitizeHistoricalText('Textos sanitizados contêm termos associados a frustração ou urgência percebida.'),
      evidenceHashes: frustration.slice(0, 5).map((record) => record.ticketIdHash),
    });
    evidence.push(...evidenceFor(frustration, 'frustration_signal'));
  }

  const communicationGaps = records.filter((record) => hasAnyWord(combinedText(record), COMMUNICATION_GAP_WORDS));
  if (communicationGaps.length > 0) {
    patterns.push({
      patternType: 'communication_gap',
      category: 'Comunicacao',
      entityLabelSanitized: null,
      frequencyAbs: communicationGaps.length,
      severity: severityFor(communicationGaps.length, total),
      descriptionSanitized: sanitizeHistoricalText('Há indícios textuais de comunicação confusa, incompleta ou pouco orientativa.'),
      evidenceHashes: communicationGaps.slice(0, 5).map((record) => record.ticketIdHash),
    });
    evidence.push(...evidenceFor(communicationGaps, 'communication_gap'));
  }

  const kbGapCandidates = [...categoryGroups.entries()]
    .filter(([, items]) => items.length >= 2 && items.some((record) => record.solutionText.length < 30 || record.reopenedCount > 0))
    .slice(0, 5);
  for (const [category, items] of kbGapCandidates) {
    patterns.push({
      patternType: 'kb_gap_candidate',
      category,
      entityLabelSanitized: null,
      frequencyAbs: items.length,
      severity: severityFor(items.length, total),
      descriptionSanitized: sanitizeHistoricalText('Tema recorrente com solução curta ou retrabalho; candidato a procedimento na KB nativa.'),
      evidenceHashes: items.slice(0, 5).map((record) => record.ticketIdHash),
    });
    evidence.push(...evidenceFor(items, 'kb_gap_candidate'));
  }

  const effectiveSolutions = [...categoryGroups.entries()]
    .filter(([, items]) => items.length >= 2 && items.every((record) => record.reopenedCount === 0) && items.some((record) => record.solutionText.length >= 40))
    .slice(0, 5);
  for (const [category, items] of effectiveSolutions) {
    patterns.push({
      patternType: 'solution_effectiveness',
      category,
      entityLabelSanitized: null,
      frequencyAbs: items.length,
      severity: 'low',
      descriptionSanitized: sanitizeHistoricalText('Soluções recorrentes sem reabertura aparente podem virar referência operacional revisada por humano.'),
      evidenceHashes: items.slice(0, 5).map((record) => record.ticketIdHash),
    });
    evidence.push(...evidenceFor(items, 'solution_effectiveness'));
  }

  const averageSolutionHours = avgHoursToSolution(records);
  if (total > 0) {
    insights.push(insight(
      'volume',
      total >= 50 ? 'medium' : 'low',
      'Volume offline processado',
      `${total} chamados sanitizados foram processados nesta janela offline.`,
      'Usar janelas pequenas e comparar evolução por categoria antes de expandir o período.',
      90,
      { rows_processed: total },
    ));
  }
  if (averageSolutionHours !== null) {
    insights.push(insight(
      'response_time',
      averageSolutionHours > 72 ? 'high' : averageSolutionHours > 24 ? 'medium' : 'low',
      'Tempo médio até solução',
      `Tempo médio aproximado até solução: ${averageSolutionHours} horas, calculado somente quando opened_at e solved_at existem.`,
      'Investigar categorias acima da média em nova rodada offline, sem acionar automações.',
      80,
      { average_solution_hours: averageSolutionHours },
    ));
  }
  if (reopened.length > 0) {
    insights.push(insight(
      'reopen',
      severityFor(reopened.length, total) === 'high' ? 'high' : 'medium',
      'Reaberturas e retrabalho',
      `${reopened.length} chamados possuem sinal de reabertura no dataset sanitizado.`,
      'Revisar amostras anonimizadas e comparar com procedimentos existentes antes de propor mudanças.',
      78,
      { reopened_count: reopened.length },
    ));
  }
  if (frustration.length > 0) {
    insights.push(insight(
      'satisfaction_risk',
      severityFor(frustration.length, total) === 'high' ? 'high' : 'medium',
      'Risco de satisfação',
      `${frustration.length} registros têm linguagem associada a frustração ou urgência percebida.`,
      'Usar como coaching não punitivo de comunicação e priorização, sempre com revisão humana.',
      70,
      { frustration_signals: frustration.length },
    ));
  }
  if (communicationGaps.length > 0) {
    insights.push(insight(
      'communication',
      'medium',
      'Comunicação pouco clara',
      `${communicationGaps.length} registros sugerem falta de clareza ou orientação nas interações.`,
      'Criar exemplos internos de resposta clara na KB nativa, sem envio automático ao cliente.',
      68,
      { communication_gap_signals: communicationGaps.length },
    ));
  }
  if (kbGapCandidates.length > 0) {
    insights.push(insight(
      'kb_opportunity',
      'medium',
      'Oportunidades futuras de KB',
      `${kbGapCandidates.length} categorias recorrentes parecem candidatas a artigo ou revisão de procedimento.`,
      'Submeter candidatos a curadoria humana na KB nativa; não publicar automaticamente.',
      72,
      { categories: kbGapCandidates.map(([category]) => category) },
    ));
  }

  return {
    run: {
      runId,
      inputHash: dataset.inputHash,
      windowStart: options.windowStart ?? null,
      windowEnd: options.windowEnd ?? null,
      rowsSeen: dataset.rowsSeen,
      rowsProcessed: records.length,
      rowsRejected: dataset.rowsRejected,
    },
    patterns,
    insights,
    evidence,
  };
}
