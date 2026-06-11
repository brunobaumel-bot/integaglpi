/**
 * Enriquecimento de KB por agente externo (Cursor) — substitui Ollama local.
 * Expande conteúdo existente + evidências sanitizadas; nunca inventa PII.
 */

import type { EnrichedKbDraft } from './KbEnrichmentService.js';
import { INFO_UNAVAILABLE } from './KbEnrichmentService.js';
import {
  detectKbScenario,
  getQualityPlaybook,
  mergePlaybookWithRecord,
} from './KbQualityPlaybooks.js';

export interface AgentCandidateRecord {
  id: number;
  title: string;
  problem_pattern?: string;
  problemPattern?: string;
  symptoms?: string[];
  symptomsJson?: string[];
  probable_cause?: string;
  probableCause?: string;
  procedure?: string[];
  recommendedProcedureJson?: string[];
  checklist?: string[];
  checklistJson?: string[];
  tags?: string[];
  tagsJson?: string[];
  category?: string;
  categorySuggestion?: string;
  evidence?: string;
  evidenceSummarySanitized?: string;
  content_markdown?: string;
  enrichment?: Partial<EnrichedKbDraft>;
}

const GENERIC_PROC_MARKERS = [
  'Confirmar o cenario com o usuario',
  'Usar janelas pequenas',
  'Validar a solucao com supervisor',
];

const GENERIC_SYMPTOM = 'Ocorrencia recorrente em';

function arr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function normRecord(r: AgentCandidateRecord) {
  return {
    id: r.id,
    title: String(r.title ?? '').trim(),
    problemPattern: String(r.problem_pattern ?? r.problemPattern ?? '').trim(),
    symptoms: arr(r.symptoms ?? r.symptomsJson),
    probableCause: String(r.probable_cause ?? r.probableCause ?? '').trim(),
    procedure: arr(r.procedure ?? r.recommendedProcedureJson),
    checklist: arr(r.checklist ?? r.checklistJson),
    tags: arr(r.tags ?? r.tagsJson),
    category: String(r.category ?? r.categorySuggestion ?? '').trim(),
    evidence: String(r.evidence ?? r.evidenceSummarySanitized ?? '').trim(),
  };
}

function unique(items: string[], limit = 12): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const v = raw.replace(/\s+/g, ' ').trim();
    if (v.length < 4 || seen.has(v.toLowerCase())) continue;
    seen.add(v.toLowerCase());
    out.push(v.slice(0, 240));
    if (out.length >= limit) break;
  }
  return out;
}

function extractEvidenceSnippets(evidence: string): string[] {
  if (!evidence) return [];
  return unique(
    evidence
      .split('|')
      .map((s) =>
        s
          .replace(/\[NOME\]|\[TRUNCADO\]|Atenciosamente.*/gi, '')
          .replace(/Bom dia!.*?(?=\\"|$)/gi, '')
          .replace(/Segue baixo.*?(?=\\"|$)/gi, '')
          .replace(/Chamado encerrado.*/gi, '')
          .replace(/\\"/g, '')
          .trim(),
      )
      .filter((s) => s.length >= 12 && !/^LYX\s-/i.test(s)),
    10,
  );
}

function inferProduct(category: string, tags: string[], title: string): string {
  const text = `${category} ${tags.join(' ')} ${title}`.toLowerCase();
  const map: Array<[RegExp, string]> = [
    [/micromed/, 'Micromed'],
    [/synology|nas|hyper backup/, 'Synology NAS'],
    [/veeam|backup/, 'Backup / Veeam'],
    [/vpn|openvpn|fortinet|forticlient|wireguard/, 'VPN / Acesso remoto'],
    [/active directory|ad\b|ldap|dominio|azure ad/, 'Active Directory'],
    [/outlook/, 'Microsoft Outlook / M365'],
    [/office|microsoft 365|word|excel/, 'Microsoft Office / M365'],
    [/azure|microsoft cloud/, 'Microsoft Azure'],
    [/glpi/, 'GLPI'],
    [/windows|servidor/, 'Windows Server'],
    [/rede|switch|firewall|internet|link/, 'Rede / Conectividade'],
    [/playbook|incidente critico/, 'Infraestrutura / Serviços críticos'],
    [/reabertura|reopen/, 'Gestão de chamados / Qualidade'],
    [/satisfacao|csat|pesquisa/, 'Experiência do cliente / CSAT'],
    [/licen[cç]a|ativacao/, 'Licenciamento de software'],
    [/impressora|print/, 'Impressão'],
    [/email|e-mail|smtp/, 'E-mail'],
  ];
  for (const [re, label] of map) {
    if (re.test(text)) return label;
  }
  return category || INFO_UNAVAILABLE;
}

function isGenericProcedure(steps: string[]): boolean {
  if (steps.length === 0) return true;
  const joined = steps.join(' ');
  return GENERIC_PROC_MARKERS.filter((m) => joined.includes(m)).length >= 2;
}

function buildResolutionFromEvidence(snippets: string[], category: string): string[] {
  const steps: string[] = [];
  if (snippets.length > 0) {
    steps.push(`Confirmar com o solicitante o sintoma reportado: "${snippets[0]!.slice(0, 120)}"`);
  } else {
    steps.push('Confirmar com o solicitante o sintoma, escopo e impacto operacional');
  }
  steps.push(`Classificar o chamado na categoria "${category || 'geral'}" e registrar evidências objetivas`);
  steps.push('Executar diagnóstico consultivo conforme verificações abaixo (sem alterações destrutivas)');
  steps.push('Aplicar correção mínima necessária e documentar causa provável');
  steps.push('Validar com o usuário que o problema foi resolvido antes de encerrar');
  return steps;
}

function categoryExtras(category: string, title: string): {
  triage: string[];
  rollback: string[];
  escalation: string[];
  prevention: string[];
  falsePositives: string[];
  incidentTree: string[];
} {
  const cat = `${category} ${title}`.toLowerCase();
  if (cat.includes('playbook') || cat.includes('incidente')) {
    return {
      triage: [
        'Qual serviço/endpoint está indisponível e desde quando?',
        'O problema é total ou parcial (alguns usuários/regiões)?',
        'Houve deploy, alteração de configuração ou manutenção recente?',
        'Monitoramento/alertas apontam qual componente (app, DB, rede, LB)?',
      ],
      incidentTree: [
        'Indisponibilidade total → verificar serviço, rede e dependências upstream',
        'Erros intermitentes → correlacionar logs, carga e timeouts',
        'Lentidão → medir CPU/RAM/disco e filas antes de reiniciar',
      ],
      rollback: [
        'Reverter última alteração de configuração se aplicável',
        'Restaurar snapshot/backup do serviço conforme runbook aprovado',
        'Documentar rollback e manter serviço em modo degradado se necessário',
      ],
      escalation: [
        'Indisponibilidade > 30 min sem causa identificada',
        'Impacto em produção crítica ou múltiplos clientes',
        'Necessidade de acesso privilegiado ou fornecedor externo',
      ],
      prevention: [
        'Monitoramento proativo de disponibilidade e recursos',
        'Change management com janela e rollback testado',
        'Runbooks atualizados e testados periodicamente',
      ],
      falsePositives: [
        'Indisponibilidade reportada por cache DNS local do cliente',
        'Timeout causado por rede do usuário, não pelo serviço',
      ],
    };
  }
  if (cat.includes('office') || cat.includes('m365')) {
    return {
      triage: [
        'Qual aplicativo Office apresenta falha (Word, Excel, Outlook)?',
        'A conta Microsoft 365 está ativa e licenciada?',
        'O erro ocorre online, offline ou após atualização?',
      ],
      incidentTree: [
        'Falha de ativação → validar licença/conta M365',
        'App não abre → reparo online / Safe Mode',
        'Sincronização → verificar conectividade e credenciais',
      ],
      rollback: ['Desfazer alteração de perfil Outlook se criado para teste', 'Restaurar backup de PST se movido'],
      escalation: ['Licenciamento corporativo bloqueado', 'Corrupção persistente após reparo'],
      prevention: ['Manter Office atualizado via canal corporativo', 'Validar licença antes de troca de máquina'],
      falsePositives: ['Licença válida mas cache de ativação corrompido'],
    };
  }
  if (cat.includes('vpn')) {
    return {
      triage: [
        'Qual cliente VPN (FortiClient, OpenVPN, outro)?',
        'Erro exato ao conectar (credencial, timeout, certificado)?',
        'Funciona em outra rede (4G/casa vs escritório)?',
      ],
      incidentTree: [
        'Credencial/senha → reset orientado pelo processo',
        'Timeout → rede/firewall/porta',
        'Certificado → validade e cadeia',
      ],
      rollback: ['Remover perfil VPN de teste criado no cliente'],
      escalation: ['Falha em massa (>3 usuários)', 'Indisponibilidade do concentrador VPN'],
      prevention: ['Documentar perfil VPN padrão', 'Alertas de expiração de certificados'],
      falsePositives: ['VPN ok mas recurso interno indisponível'],
    };
  }
  if (cat.includes('reabertura')) {
    return {
      triage: [
        'O chamado foi reaberto pelo cliente ou automaticamente?',
        'A solução anterior foi validada com o usuário?',
        'Existe checklist de encerramento documentado?',
      ],
      incidentTree: [
        'Reabertura por sintoma persistente → revisar diagnóstico original',
        'Reabertura por novo sintoma → tratar como novo escopo',
      ],
      rollback: ['Reabrir chamado pai se encerramento prematuro confirmado'],
      escalation: ['Reaberturas recorrentes (>2) no mesmo ticket', 'Impacto alto sem causa raiz'],
      prevention: ['Checklist de validação antes de SOLVED', 'Confirmação explícita do solicitante'],
      falsePositives: ['Cliente reabriu por dúvida, não por falha real'],
    };
  }
  return {
    triage: [
      'Qual é o sintoma exato e desde quando ocorre?',
      'Quantos usuários/sistemas são afetados?',
      'Houve mudança recente (update, config, hardware)?',
    ],
    incidentTree: [
      'Isolar se é problema local (máquina/usuário) ou serviço compartilhado',
      'Correlacionar logs/eventos do período do incidente',
    ],
    rollback: ['Reverter alteração de teste', 'Restaurar configuração anterior documentada'],
    escalation: ['Sem progresso após diagnóstico inicial', 'Risco operacional ou dados sensíveis'],
    prevention: ['Registrar causa raiz e ação preventiva no encerramento', 'Atualizar KB se padrão recorrente'],
    falsePositives: ['Sintoma intermitente não reproduzido na triagem'],
  };
}

function buildCommands(category: string, product: string): string[] {
  const cat = category.toLowerCase();
  if (cat.includes('vpn')) {
    return [
      'Verificar conectividade com endpoint VPN (ping/telnet porta — consultivo)',
      'Validar credenciais e expiração de certificado no cliente VPN',
      'Conferir logs do concentrador VPN no horário da falha',
    ];
  }
  if (cat.includes('office')) {
    return [
      'Office: Arquivo > Conta > Verificar status de ativação',
      'Executar reparo rápido/online via Programs and Features (consultivo)',
      'Testar abertura em modo seguro do aplicativo afetado',
    ];
  }
  if (cat.includes('playbook') || cat.includes('servidor')) {
    return [
      'Verificar status do serviço (systemctl/services.msc — consultivo)',
      'Analisar uso de CPU/RAM/disco no período da falha',
      'Revisar logs de aplicação e eventos do SO correlacionados',
    ];
  }
  return [
    `Identificar componente afetado (${product})`,
    'Coletar logs/eventos do horário do incidente (consultivo)',
    'Validar conectividade e permissões antes de alterações',
  ];
}

function buildAliases(title: string, tags: string[], category: string): string[] {
  const base = unique(
    [
      ...tags.filter((t) => !['faq-interno', 'recurring-category', 'checklist-diagnostico'].includes(t)),
      category.split('>').pop()?.trim() ?? '',
      title.replace(/^(Procedimento sugerido|Solução comum|Checklist de diagnóstico):\s*/i, ''),
    ].filter(Boolean),
    6,
  );
  return base.length > 0 ? base : [INFO_UNAVAILABLE];
}

const PLACEHOLDER_CAUSES = [
  'nao identificado',
  'revisar evidencias',
  'hipotese: solucao incompleta',
];

function isPlaceholderCause(text: string): boolean {
  const t = text.toLowerCase().trim();
  return t === '' || PLACEHOLDER_CAUSES.some((p) => t.includes(p));
}

/** Gera campos enriquecidos acionáveis (playbook operacional + evidências). */
export function enrichAgentCandidate(raw: AgentCandidateRecord): Partial<EnrichedKbDraft> {
  const r = normRecord(raw);
  const snippets = extractEvidenceSnippets(r.evidence);
  const product = inferProduct(r.category, r.tags, r.title);
  const scenario = detectKbScenario(raw);
  const playbook = mergePlaybookWithRecord(getQualityPlaybook(scenario), raw, [
    ...snippets.slice(0, 5),
    ...r.symptoms.filter((s) => !s.startsWith(GENERIC_SYMPTOM) && !s.includes('Categoria associada')),
  ]);

  const existingCauses = unique(
    r.probableCause
      .split(/[;.]/)
      .map((c) => c.trim())
      .filter((c) => c.length > 8 && !isPlaceholderCause(c)),
    6,
  );

  const existingSteps = isGenericProcedure(r.procedure) ? [] : r.procedure;
  const resolution = unique(
    scenario === 'critical_incident' && existingSteps.length >= 5
      ? [...existingSteps.filter((s) => !s.includes('Validar com o usuário que o problema')), ...playbook.resolutionSteps.slice(-2)]
      : playbook.resolutionSteps,
    12,
  );

  const validation = unique(
    [
      ...playbook.validationSteps,
      ...r.checklist.filter((c) => !c.includes('artigo nativo equivalente')),
    ],
    10,
  );

  const aiHint = snippets.slice(0, 3).join(' | ') || r.evidence.slice(0, 280) || playbook.context.slice(0, 200);

  return {
    product_or_system: product,
    category: r.category || INFO_UNAVAILABLE,
    aliases: buildAliases(r.title, r.tags, r.category),
    context: playbook.context.slice(0, 600),
    symptoms: playbook.symptoms.length > 0 ? playbook.symptoms : [INFO_UNAVAILABLE],
    likely_causes:
      existingCauses.length > 0
        ? unique([...existingCauses, ...playbook.likelyCauses.slice(0, 3)], 8)
        : playbook.likelyCauses,
    resolution_steps: resolution,
    validation_steps: validation,
    commands_or_checks: playbook.commandsOrChecks,
    triage_questions: playbook.triageQuestions,
    incident_tree: playbook.incidentTree,
    rollback_or_safe_exit: playbook.rollbackOrSafeExit,
    escalation_when: playbook.escalationWhen,
    prevention: playbook.prevention,
    known_false_positives: playbook.knownFalsePositives,
    ai_hint: aiHint.slice(0, 400),
    confidence_notes:
      `Playbook operacional (${scenario}) — revisão agente Cursor; candidato #${r.id}; rollback disponível.`,
  };
}
