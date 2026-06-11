/**
 * Reescrita estruturada F3/F4 — formato 16 seções + metadados de busca.
 */

import { enrichAgentCandidate, type AgentCandidateRecord } from './AgentKbEnricher.js';
import { INFO_UNAVAILABLE } from './KbEnrichmentService.js';
import type { EnrichedKbDraft } from './KbEnrichmentService.js';
import { detectKbScenario, getQualityPlaybook } from './KbQualityPlaybooks.js';
import { assessKbEffectiveness, inferSourceTier } from './KbEffectivenessAuditor.js';

export interface KbContentRewriteResult {
  markdown: string;
  draft: EnrichedKbDraft & {
    must_terms: string[];
    negative_terms: string[];
    prerequisites: string[];
    tools_required: string[];
    difficulty_level: 'Basico' | 'Intermediario' | 'Avancado';
    when_to_use: string[];
    when_not_to_use: string[];
  };
  assessment_before: ReturnType<typeof assessKbEffectiveness>;
  scenario: string;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80);
}

function inferDifficulty(scenario: string): 'Basico' | 'Intermediario' | 'Avancado' {
  if (['critical_incident', 'backup_restore', 'windows_server', 'ad_sync'].includes(scenario)) {
    return 'Avancado';
  }
  if (['vpn_connect_fail', 'office_activation', 'network_share', 'micromed'].includes(scenario)) {
    return 'Intermediario';
  }
  return 'Basico';
}

function buildPrerequisites(scenario: string): string[] {
  const map: Record<string, string[]> = {
    vpn_connect_fail: [
      'Acesso ao cliente VPN instalado na estação do usuário',
      'Permissão para orientar reset de senha AD (canal aprovado)',
      'Print do erro e horário da falha',
    ],
    office_activation: [
      'Acesso local à estação com Office instalado',
      'Permissão consultiva no portal M365 admin (licenças)',
      'Conta UPN corporativa do usuário (<USUARIO>@<DOMINIO>)',
    ],
    micromed: [
      'Acesso administrativo local ou RDS ao servidor/estação Micromed',
      'Permissão para verificar serviços Windows relacionados',
      'Print do erro e versão do Micromed',
    ],
    backup_restore: [
      'Acesso ao console de backup (Synology/Veeam/outro)',
      'Janela acordada para restore em pasta alternativa',
      'Identificação do ponto de restore (data/hora)',
    ],
    printer: ['Acesso local ou admin ao spooler de impressão', 'Driver aprovado disponível'],
  };
  return map[scenario] ?? [
    'Acesso à estação/serviço afetado',
    'Permissão para coletar logs e prints',
    'Ticket com descrição objetiva do sintoma',
  ];
}

function buildMustTerms(product: string, scenario: string): string[] {
  const base = [product.toLowerCase(), scenario.replace(/_/g, ' ')];
  const extra: Record<string, string[]> = {
    vpn_connect_fail: ['vpn', 'conectar', 'forticlient', 'tunnel'],
    office_activation: ['office', 'ativacao', 'm365', 'licenca'],
    micromed: ['micromed', 'nao abre', 'aplicacao'],
    backup_restore: ['backup', 'restore', 'restaurar', 'synology'],
    network_share: ['compartilhamento', 'unc', 'acesso negado'],
  };
  return [...new Set([...base, ...(extra[scenario] ?? [])])].filter((t) => t.length > 2).slice(0, 8);
}

function buildNegativeTerms(scenario: string): string[] {
  const map: Record<string, string[]> = {
    office_activation: ['synology', 'micromed', 'backup', 'vpn'],
    micromed: ['slmgr', 'ativacao windows', 'synology', 'office'],
    backup_restore: ['micromed', 'office ativacao', 'outlook'],
    vpn_connect_fail: ['office', 'impressora', 'micromed'],
    generic_it: ['micromed', 'synology restore'],
  };
  return map[scenario] ?? ['micromed', 'synology'];
}

export function buildKbContentRewrite(raw: AgentCandidateRecord): KbContentRewriteResult {
  const assessment_before = assessKbEffectiveness(raw);
  const scenario = detectKbScenario(raw);
  const playbook = getQualityPlaybook(scenario);
  const base = enrichAgentCandidate(raw);
  const product = base.product_or_system ?? INFO_UNAVAILABLE;
  const sourceTier = inferSourceTier(String(raw.category ?? raw.categorySuggestion ?? ''), product);
  const difficulty = inferDifficulty(scenario);
  const prerequisites = buildPrerequisites(scenario);
  const mustTerms = buildMustTerms(product, scenario);
  const negativeTerms = buildNegativeTerms(scenario);
  const forbidden = base.known_false_positives ?? [];

  const actionTitle = `${product} — ${playbook.titleSuffix}`;
  const whenToUse = [
    ...playbook.symptoms.slice(0, 4),
    ...(base.symptoms ?? []).slice(0, 3),
  ];
  const whenNotToUse = [
    ...(base.known_false_positives ?? []),
    ...negativeTerms.map((t) => `Busca relacionada a "${t}" — usar KB específico desse produto`),
  ];

  const resumo = {
    problema: whenToUse[0] ?? playbook.context.slice(0, 120),
    causa: (base.likely_causes ?? [])[0] ?? INFO_UNAVAILABLE,
    solucao: (base.resolution_steps ?? [])[0] ?? INFO_UNAVAILABLE,
  };

  const markdown = [
    `# ${actionTitle}`,
    '',
    `**Produto/Sistema:** ${product}  `,
    `**Categoria GLPI sugerida:** ${base.category ?? INFO_UNAVAILABLE}  `,
    `**Source Tier:** ${sourceTier}  `,
    `**Nível de dificuldade:** ${difficulty}  `,
    `**Aliases / termos de busca:** ${(base.aliases ?? []).join(', ')}  `,
    `**Tags:** ${(base.tags ?? []).join(', ')}  `,
    `**Forbidden terms:** ${forbidden.concat(negativeTerms).join(', ')}  `,
    '',
    '> DRAFT enriquecido — revisão humana obrigatória. Original preservado para rollback.',
    '',
    '## 1. Resumo executivo',
    '',
    `* **Problema:** ${resumo.problema}`,
    `* **Causa provável:** ${resumo.causa}`,
    `* **Solução resumida:** ${resumo.solucao}`,
    '',
    '## 2. Quando usar este KB',
    '',
    ...whenToUse.map((w) => `* ${w}`),
    '',
    '## 3. Quando NÃO usar este KB',
    '',
    ...whenNotToUse.map((w) => `* ${w}`),
    '',
    '## 4. Quando escalar',
    '',
    ...((base.escalation_when ?? []) as string[]).map((e) => `* ${e}`),
    '* **Tempo máximo N1 antes de escalar:** 30 minutos sem progresso',
    '* **Evidências a coletar:** prints, logs, horário, escopo (1 vs N usuários)',
    '',
    '## 5. Sintomas observáveis',
    '',
    ...((base.symptoms ?? []) as string[]).map((s) => `* ${s}`),
    '',
    '## 6. Causa mais provável',
    '',
    ...((base.likely_causes ?? []) as string[]).map((c) => `* ${c}`),
    '',
    '## 7. Pré-requisitos',
    '',
    ...prerequisites.map((p) => `* ${p}`),
    '',
    '## 8. Ferramentas necessárias',
    '',
    ...((base.commands_or_checks ?? []) as string[]).map((c) => `* ${c}`),
    '',
    '## 9. Triagem rápida',
    '',
    ...((base.triage_questions ?? []) as string[]).map((q, i) => `${i + 1}. ${q}`),
    '',
    '## 10. Passo a passo técnico de resolução',
    '',
    ...((base.resolution_steps ?? []) as string[]).map((step, i) => {
      const n = step.match(/^\d+\./) ? step : `${i + 1}. ${step}`;
      return `${n}\n   * **Como executar:** seguir procedimento consultivo no ambiente do cliente.\n   * **Evidência esperada:** sintoma reproduzido ou eliminado; registrar no ticket.`;
    }),
    '',
    '## 11. Verificações e diagnóstico',
    '',
    ...((base.commands_or_checks ?? []) as string[]).map((c) => `* ${c}`),
    '',
    '## 12. Como validar que resolveu',
    '',
    ...((base.validation_steps ?? []) as string[]).map((v) => `* ${v}`),
    '',
    '## 13. Riscos, cuidados e rollback',
    '',
    ...((base.rollback_or_safe_exit ?? []) as string[]).map((r) => `* **Rollback:** ${r}`),
    '* **Risco:** alteração em produção sem janela — mitigar com backup/pré-validação',
    '',
    '## 14. Possíveis outras causas',
    '',
    ...((base.incident_tree ?? []) as string[]).map((t) => `* ${t}`),
    '',
    '## 15. Prevenção e boas práticas',
    '',
    ...((base.prevention ?? []) as string[]).map((p) => `* ${p}`),
    '',
    '## 16. Metadados para IA e busca',
    '',
    `* **product_or_system:** ${product}`,
    `* **aliases:** ${(base.aliases ?? []).join(', ')}`,
    `* **symptoms:** ${(base.symptoms ?? []).slice(0, 5).join('; ')}`,
    `* **must_terms:** ${mustTerms.join(', ')}`,
    `* **negative_terms:** ${negativeTerms.join(', ')}`,
    `* **forbidden_terms:** ${forbidden.join(', ')}`,
    `* **known_false_positives:** ${forbidden.join(', ')}`,
    `* **ai_hint:** ${base.ai_hint ?? INFO_UNAVAILABLE}`,
    `* **confidence_notes:** ${base.confidence_notes ?? ''} Cenário: ${scenario}.`,
    '* **human_review_required:** true',
    '',
    '## Observações do enriquecimento',
    '',
    '* **Melhorado:** passos numerados, triagem, validação, metadados must/forbidden, 16 seções.',
    `* **INFORMAÇÃO_INDISPONÍVEL:** campos sem evidência no original permanecem genéricos.`,
    '* **Revisão humana:** validar comandos específicos do ambiente antes de publicar na KB GLPI.',
  ].join('\n');

  const draft: KbContentRewriteResult['draft'] = {
    title: actionTitle.slice(0, 200),
    slug: slugify(actionTitle),
    product_or_system: product,
    source_tier: sourceTier,
    category: base.category ?? INFO_UNAVAILABLE,
    aliases: base.aliases ?? [INFO_UNAVAILABLE],
    symptoms: base.symptoms ?? [INFO_UNAVAILABLE],
    tags: base.tags ?? [],
    ai_hint: base.ai_hint ?? INFO_UNAVAILABLE,
    context: base.context ?? INFO_UNAVAILABLE,
    triage_questions: base.triage_questions ?? [INFO_UNAVAILABLE],
    incident_tree: base.incident_tree ?? [INFO_UNAVAILABLE],
    commands_or_checks: base.commands_or_checks ?? [INFO_UNAVAILABLE],
    likely_causes: base.likely_causes ?? [INFO_UNAVAILABLE],
    resolution_steps: base.resolution_steps ?? [INFO_UNAVAILABLE],
    validation_steps: base.validation_steps ?? [INFO_UNAVAILABLE],
    rollback_or_safe_exit: base.rollback_or_safe_exit ?? [INFO_UNAVAILABLE],
    escalation_when: base.escalation_when ?? [INFO_UNAVAILABLE],
    prevention: base.prevention ?? [INFO_UNAVAILABLE],
    known_false_positives: base.known_false_positives ?? [INFO_UNAVAILABLE],
    forbidden_terms: [...new Set([...forbidden, ...negativeTerms])].slice(0, 12),
    confidence_notes:
      `${base.confidence_notes ?? ''} Reescrita F3 16-seções (${scenario}); human_review_required.`,
    human_review_required: true,
    must_terms: mustTerms,
    negative_terms: negativeTerms,
    prerequisites,
    tools_required: (base.commands_or_checks ?? []) as string[],
    difficulty_level: difficulty,
    when_to_use: whenToUse,
    when_not_to_use: whenNotToUse,
  };

  return { markdown, draft, assessment_before, scenario };
}
