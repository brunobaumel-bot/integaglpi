/**
 * Classificação de efetividade de KB (F1/F2) — read-only heurísticas.
 */

import type { AgentCandidateRecord } from './AgentKbEnricher.js';

export type KbEffectivenessStatus = 'EFETIVO' | 'PARCIAL' | 'INSUFICIENTE' | 'INCORRETO';

export interface KbEffectivenessAssessment {
  status: KbEffectivenessStatus;
  motivo: string;
  prioridade: 'ALTA' | 'MEDIA' | 'BAIXA';
  checks: Record<string, boolean>;
}

const GENERIC_MARKERS = [
  'confirmar o cenario com o usuario',
  'classificar o chamado na categoria',
  'validar a solucao com supervisor',
  'revisar evidencias anonimizadas',
  'nao identificado com seguranca',
];

function arr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function norm(r: AgentCandidateRecord) {
  return {
    title: String(r.title ?? ''),
    procedure: arr(r.procedure ?? r.recommendedProcedureJson),
    checklist: arr(r.checklist ?? r.checklistJson),
    cause: String(r.probable_cause ?? r.probableCause ?? ''),
    symptoms: arr(r.symptoms ?? r.symptomsJson),
    evidence: String(r.evidence ?? r.evidenceSummarySanitized ?? ''),
    markdown: String(r.content_markdown ?? ''),
  };
}

export function assessKbEffectiveness(r: AgentCandidateRecord): KbEffectivenessAssessment {
  const n = norm(r);
  const procText = n.procedure.join(' ').toLowerCase();
  const hasGeneric = GENERIC_MARKERS.filter((m) => procText.includes(m)).length >= 2;
  const hasNumberedSteps = n.procedure.some((s) => /^\d+\./.test(s.trim()));
  const hasValidation = n.checklist.length >= 2
    || n.markdown.includes('Como validar')
    || n.procedure.some((s) => /validar|confirmar resolu/i.test(s));
  const hasPlaceholderCause = GENERIC_MARKERS.some((m) => n.cause.toLowerCase().includes(m));
  const hasRealSymptoms = n.symptoms.some(
    (s) => s.length > 20 && !s.toLowerCase().includes('categoria associada'),
  );
  const hasWhenNotUse = n.markdown.includes('Quando NÃO usar') || n.markdown.includes('forbidden');
  const hasPrereq = n.markdown.includes('Pré-requisitos') || n.markdown.includes('Ferramentas necess');
  const hasEscalation = n.markdown.includes('escalar') || n.markdown.includes('Quando escalar');
  const has16Sections = (n.markdown.match(/^## /gm) ?? []).length >= 10;

  const checks = {
    passos_numerados: hasNumberedSteps,
    validacao_objetiva: hasValidation,
    sintomas_reais: hasRealSymptoms,
    causa_tecnica: !hasPlaceholderCause && n.cause.length > 10,
    sem_template_generico: !hasGeneric,
    quando_nao_usar: hasWhenNotUse,
    pre_requisitos: hasPrereq,
    escalonamento: hasEscalation,
    formato_16_secoes: has16Sections,
  };

  const score = Object.values(checks).filter(Boolean).length;

  let status: KbEffectivenessStatus;
  let motivo: string;

  if (hasGeneric && !hasNumberedSteps) {
    status = 'INSUFICIENTE';
    motivo = 'Procedimento genérico de mineração; sem passos técnicos executáveis.';
  } else if (score >= 7) {
    status = 'EFETIVO';
    motivo = 'Passos acionáveis, validação e metadados estruturados presentes.';
  } else if (score >= 4 || (hasNumberedSteps && !hasGeneric)) {
    status = 'PARCIAL';
    motivo = 'Conteúdo parcialmente acionável; faltam seções operacionais ou metadados.';
  } else {
    status = 'INSUFICIENTE';
    motivo = 'Falta passo a passo verificável, validação ou causa técnica.';
  }

  const priorityThemes = ['vpn', 'micromed', 'synology', 'office', 'backup', 'active directory', 'impress'];
  const t = `${n.title} ${r.category ?? r.categorySuggestion ?? ''}`.toLowerCase();
  const prioridade: 'ALTA' | 'MEDIA' | 'BAIXA' =
    priorityThemes.some((p) => t.includes(p)) ? 'ALTA' : 'MEDIA';

  return { status, motivo, prioridade, checks };
}

export function inferSourceTier(category: string, product: string): string {
  const t = `${category} ${product}`.toLowerCase();
  if (/micromed|synology|veeam|m365|office|fortinet|glpi/.test(t)) return 'tier_1_product_specific';
  if (/backup|vpn|active directory|impressora|rede/.test(t)) return 'tier_2_operational_kb';
  if (/playbook|incidente/.test(t)) return 'tier_3_generic_playbook';
  return 'tier_2_operational_kb';
}
