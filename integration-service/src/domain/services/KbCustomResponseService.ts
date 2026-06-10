/**
 * KbCustomResponseService — F3 (integaglpi_v9_kb_enrichment_and_search_optimization_001)
 *
 * Transforma a(s) KB(s) recuperada(s) em orientação contextual para o TÉCNICO.
 * A resposta customizada é COMPLEMENTAR: o KB original/fonte permanece sempre
 * visível ao lado da sugestão — nunca é substituído nem omitido.
 *
 * Confidence gate (ABSOLUTO):
 *   - nivel_de_confianca < 0.60  → NÃO chama Ollama. Retorna playbook
 *     determinístico com a mensagem obrigatória.
 *   - intent 'generic' ou contexto técnico insuficiente → idem.
 *   - CUSTOM_RESPONSE_ENABLED=false → retorna null (feature desligada).
 *
 * Invariantes:
 *   - NUNCA envia resposta ao cliente (uso interno do técnico).
 *   - NUNCA executa comando (texto consultivo apenas).
 *   - NUNCA omite a KB fonte (kb_sources sempre presente quando há KB).
 *   - NUNCA gera solução sem KB: sem KB → custom response não é gerada.
 *   - PII guard aplicado a todo texto que entra no prompt.
 *   - Ollama local apenas; falha → fallback determinístico.
 */

import { env } from '../../config/env.js';
import { piiGuard } from './KbRagCopilotService.js';
import type {
  OllamaRagPort,
  KbUsed,
  TechnicianPlaybook,
} from './KbRagCopilotService.js';
import type { SearchPlan } from './KbSearchPlannerService.js';
import type { KbCandidateHit } from '../../repositories/postgres/PostgresKbCandidateSearchRepository.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export const CUSTOM_RESPONSE_MIN_CONFIDENCE = 0.60;

export const INSUFFICIENT_CONTEXT_MESSAGE =
  'Contexto insuficiente para personalização — use o checklist abaixo.';

/** Fonte de KB sempre visível junto à sugestão IA. */
export interface KbSourceRef {
  id: number;
  title: string;
  category: string;
  score: number;
}

export interface CustomTechnicianResponse {
  /** 'customized' = IA local contextualizou; 'deterministic' = gate ativado. */
  mode: 'customized' | 'deterministic';
  /** Mensagem obrigatória quando o gate de confiança/contexto bloqueia a personalização. */
  gate_message: string | null;
  /** Orientação por problema — texto consultivo, nunca executável. */
  guidance: {
    sintomas_identificados: string[];
    hipoteses_por_camada: string[];
    perguntas_de_triagem: string[];
    verificacoes_consultivas: string[];
    causa_provavel: string;
    resolucao_sugerida: string[];
    validacao: string[];
    escalonamento: string[];
    riscos_rollback: string[];
  };
  /** KB(s) fonte — SEMPRE visível; a resposta complementa, nunca substitui. */
  kb_sources: KbSourceRef[];
  nivel_de_confianca: number;
  /** Invariantes literais. */
  readonly complementa_kb_original: true;
  readonly never_sent_to_customer: true;
  readonly human_review_required: true;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hasSufficientTechnicalContext(plan: SearchPlan | null, query: string): boolean {
  if (plan === null) return false;
  if (plan.intent === 'generic' && plan.productOrSystem === null) return false;
  const technicalTokens = piiGuard(query)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/\s+/)
    .filter((t) => t.length >= 4);
  return technicalTokens.length >= 2;
}

function deterministicGuidance(playbook: TechnicianPlaybook): CustomTechnicianResponse['guidance'] {
  return {
    sintomas_identificados: playbook.sintomas_identificados,
    hipoteses_por_camada: playbook.hipoteses_por_camada,
    perguntas_de_triagem: playbook.perguntas_de_triagem,
    verificacoes_consultivas: playbook.verificacoes_ou_comandos_sugeridos,
    causa_provavel: playbook.causas_possiveis[0] ?? 'Não determinada — validar via triagem.',
    resolucao_sugerida: playbook.resolucao_sugerida,
    validacao: playbook.validacao,
    escalonamento: playbook.escalonamento,
    riscos_rollback: playbook.riscos_rollback,
  };
}

const CUSTOM_PROMPT_SYSTEM = `Você é um analista técnico sênior orientando OUTRO TÉCNICO (nunca o cliente).
Use APENAS as KBs fornecidas e o contexto do problema. Não invente comandos, causas ou soluções.
A sugestão COMPLEMENTA a KB original — cite qual KB embasa cada orientação quando possível.
Comandos são texto consultivo: execução é sempre manual e exige aprovação humana.
Responda APENAS com JSON válido com as chaves:
{"sintomas_identificados":[],"hipoteses_por_camada":[],"perguntas_de_triagem":[],"verificacoes_consultivas":[],"causa_provavel":"","resolucao_sugerida":[],"validacao":[],"escalonamento":[],"riscos_rollback":[]}
Sem PII. Sem texto fora do JSON.`;

function buildCustomPrompt(
  problemContext: string,
  articles: KbCandidateHit[],
  plan: SearchPlan | null,
): string {
  const kbBlock = articles.slice(0, 3).map((a, i) => [
    `### KB ${i + 1}: ${a.title}`,
    `Sintomas: ${a.symptomsJson.slice(0, 3).join('; ') || 'N/D'}`,
    `Causa: ${piiGuard(a.probableCause).slice(0, 200) || 'N/D'}`,
    `Passos: ${a.recommendedProcedureJson.slice(0, 4).join(' → ') || 'N/D'}`,
    `Validação: ${a.checklistJson.slice(0, 3).join(' + ') || 'N/D'}`,
  ].join('\n')).join('\n\n');

  return [
    CUSTOM_PROMPT_SYSTEM,
    '',
    `=== PROBLEMA DO TÉCNICO (${plan?.productOrSystem ?? 'sistema não identificado'} / ${plan?.intent ?? 'generic'}) ===`,
    piiGuard(problemContext).slice(0, 500),
    '',
    '=== KBs FONTE (a resposta complementa, nunca substitui) ===',
    kbBlock,
  ].join('\n');
}

function parseCustomJson(raw: string): Partial<CustomTechnicianResponse['guidance']> | null {
  const match = raw?.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    const arr = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string').slice(0, 8) : [];
    const str = (v: unknown): string => (typeof v === 'string' ? v.slice(0, 400) : '');
    return {
      sintomas_identificados: arr(parsed['sintomas_identificados']),
      hipoteses_por_camada: arr(parsed['hipoteses_por_camada']),
      perguntas_de_triagem: arr(parsed['perguntas_de_triagem']),
      verificacoes_consultivas: arr(parsed['verificacoes_consultivas']),
      causa_provavel: str(parsed['causa_provavel']),
      resolucao_sugerida: arr(parsed['resolucao_sugerida']),
      validacao: arr(parsed['validacao']),
      escalonamento: arr(parsed['escalonamento']),
      riscos_rollback: arr(parsed['riscos_rollback']),
    };
  } catch {
    return null;
  }
}

// ── Service ───────────────────────────────────────────────────────────────────

export class KbCustomResponseService {
  public constructor(private readonly ollamaPort: OllamaRagPort | null) {}

  /**
   * Constrói a resposta customizada complementar.
   *
   * @returns null quando CUSTOM_RESPONSE_ENABLED=false ou quando não há KB
   *          fonte (nunca gera solução sem KB).
   */
  public async buildCustomResponse(
    problemContext: string,
    playbook: TechnicianPlaybook,
    articles: KbCandidateHit[],
    kbsUsed: KbUsed[],
    plan: SearchPlan | null,
  ): Promise<CustomTechnicianResponse | null> {
    if (!env.CUSTOM_RESPONSE_ENABLED) {
      return null;
    }
    // Sem KB fonte → sem resposta customizada (nunca inventa solução).
    if (kbsUsed.length === 0 || articles.length === 0) {
      return null;
    }

    const kbSources: KbSourceRef[] = kbsUsed.map((k) => ({
      id: k.id,
      title: k.title,
      category: k.category,
      score: k.score,
    }));
    const confidence = playbook.nivel_de_confianca;

    // ── Confidence/context gate: NÃO chama Ollama abaixo de 0.60 ─────────────
    if (
      confidence < CUSTOM_RESPONSE_MIN_CONFIDENCE
      || !hasSufficientTechnicalContext(plan, problemContext)
    ) {
      return {
        mode: 'deterministic',
        gate_message: INSUFFICIENT_CONTEXT_MESSAGE,
        guidance: deterministicGuidance(playbook),
        kb_sources: kbSources,
        nivel_de_confianca: confidence,
        complementa_kb_original: true,
        never_sent_to_customer: true,
        human_review_required: true,
      };
    }

    // ── Personalização via Ollama local (fallback determinístico) ────────────
    let guidance = deterministicGuidance(playbook);
    let mode: CustomTechnicianResponse['mode'] = 'deterministic';

    if (this.ollamaPort !== null) {
      try {
        const prompt = buildCustomPrompt(problemContext, articles, plan);
        const raw = await this.ollamaPort.generateText(prompt, {
          temperature: 0.2,
          topP: 0.9,
          repeatPenalty: 1.1,
        });
        const parsed = parseCustomJson(raw);
        if (parsed !== null) {
          const det = guidance;
          guidance = {
            sintomas_identificados: parsed.sintomas_identificados?.length ? parsed.sintomas_identificados : det.sintomas_identificados,
            hipoteses_por_camada: parsed.hipoteses_por_camada?.length ? parsed.hipoteses_por_camada : det.hipoteses_por_camada,
            perguntas_de_triagem: parsed.perguntas_de_triagem?.length ? parsed.perguntas_de_triagem : det.perguntas_de_triagem,
            verificacoes_consultivas: parsed.verificacoes_consultivas?.length ? parsed.verificacoes_consultivas : det.verificacoes_consultivas,
            causa_provavel: parsed.causa_provavel || det.causa_provavel,
            resolucao_sugerida: parsed.resolucao_sugerida?.length ? parsed.resolucao_sugerida : det.resolucao_sugerida,
            validacao: parsed.validacao?.length ? parsed.validacao : det.validacao,
            escalonamento: parsed.escalonamento?.length ? parsed.escalonamento : det.escalonamento,
            riscos_rollback: parsed.riscos_rollback ?? det.riscos_rollback,
          };
          mode = 'customized';
        }
      } catch {
        // Ollama indisponível/timeout → fallback determinístico já preparado.
      }
    }

    return {
      mode,
      gate_message: null,
      guidance,
      kb_sources: kbSources,
      nivel_de_confianca: confidence,
      complementa_kb_original: true,
      never_sent_to_customer: true,
      human_review_required: true,
    };
  }
}
