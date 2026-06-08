/**
 * KbRagCopilotService — Local RAG copilot for technicians.
 *
 * Flow:
 *   1. PII guard: scrub potential PII from query.
 *   2. QueryExpansionService: deterministic + optional local AI term expansion.
 *   3. Redis cache check (TTL 300s): skip DB search on hit.
 *   4. PostgreSQL lexical search (FTS over kb_candidates).
 *   5. KbRankingService: hybrid score (0.60×lexical + field matches + context boost).
 *   6. Build RAG prompt from retrieved snippets only (never full KB).
 *      MASTER_PROMPT: senior analyst role, 10 mandatory sections.
 *   7. Call local Ollama (temperature=0.2, top_p=0.9, repeat_penalty=1.1).
 *   8. Parse structured JSON (10+2 content sections).
 *   9. Fallback to deterministic playbook if Ollama fails/times out.
 *  10. Audit (fire-and-forget).
 *
 * Invariants:
 *   - NEVER uses cloud AI.
 *   - NEVER sends full KB to the model (max 5 articles × bounded snippets).
 *   - NEVER executes commands automatically.
 *   - NEVER sends response to the customer.
 *   - NEVER mutates tickets.
 *   - Local Ollama is optional; deterministic fallback always available.
 *   - PII guard applied before any AI call or cache key generation.
 *
 * Phase: integaglpi_local_kb_rag_technician_copilot_001
 * Adendo 1: integaglpi_local_kb_rag_technician_copilot_001_adendo_pipeline_qdrant_001
 * Adendo 2: integaglpi_local_kb_rag_model_query_expansion_adendum_001
 */

import type { KbCandidateSearchRepository, KbCandidateHit } from '../../repositories/postgres/PostgresKbCandidateSearchRepository.js';
import { QueryExpansionService } from './QueryExpansionService.js';
import { KbRankingService } from './KbRankingService.js';
import type { KbClientContext, KbScoreBreakdown } from './KbRankingService.js';

// Re-export for consumers (tests, controllers, buildDependencies)
export type { KbCandidateSearchRepository, KbCandidateHit } from '../../repositories/postgres/PostgresKbCandidateSearchRepository.js';
export type { KbClientContext } from './KbRankingService.js';

// ── Ports ─────────────────────────────────────────────────────────────────────

export interface OllamaGenerationOptions {
  temperature?: number;
  topP?: number;
  repeatPenalty?: number;
}

/**
 * Local Ollama text generation port.
 * Cloud AI is structurally absent — no cloud implementation accepted.
 */
export interface OllamaRagPort {
  generateText(prompt: string, options?: OllamaGenerationOptions): Promise<string>;
}

export interface RagAuditPort {
  writeRagAudit(event: RagAuditEvent): Promise<void>;
}

export interface RagAuditEvent {
  ticketId: number | null;
  queryHash: string;
  kbIdsUsed: number[];
  rankingScores: number[];
  source: 'local_kb';
  localAiUsed: boolean;
  deterministicFallback: boolean;
  technicianId: number | null;
}

/**
 * Redis cache port for search results.
 * Key = hash of expanded query (no PII). TTL = KB_RAG_CACHE_TTL_SECONDS.
 */
export interface KbRagCachePort {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

// ── Domain types ──────────────────────────────────────────────────────────────

export interface KbRagInput {
  query: string;
  ticketId?: number | null;
  technicianId?: number | null;
  topK?: number;
  /** Optional client context for ranking boost (never hard filter). */
  clientContext?: KbClientContext | null;
}

export interface KbUsed {
  id: number;
  title: string;
  category: string;
  score: number;
}

/** Per-KB score breakdown for UI transparency. */
export interface KbScoreEntry {
  id: number;
  title: string;
  totalScore: number;
  breakdown: {
    lexicalScore: number;
    symptomsMatch: boolean;
    aiHintMatch: boolean;
    tagsMatch: boolean;
    titleMatch: boolean;
    contextBoost: boolean;
  };
}

/**
 * 12-section technician playbook.
 * Fields 1–10 come from AI (merged with deterministic fallback) or deterministic alone.
 * kbs_utilizadas and avisos_de_seguranca are always service-added.
 */
export interface TechnicianPlaybook {
  resumo_do_incidente: string;                   // 1
  sintomas_identificados: string[];              // 2
  hipoteses_por_camada: string[];                // 3 (rede/servidor/aplicação/identidade/backup/segurança)
  perguntas_de_triagem: string[];                // 4
  verificacoes_ou_comandos_sugeridos: string[];  // 5 (suggestion only — human executes)
  causas_possiveis: string[];                    // 6
  resolucao_sugerida: string[];                  // 7
  validacao: string[];                           // 8
  escalonamento: string[];                       // 9
  riscos_rollback: string[];                     // 10
  kbs_utilizadas: KbUsed[];                      // service-added
  nivel_de_confianca: number;                    // service-added
  avisos_de_seguranca: string[];                 // always appended by service
}

export interface KbRagResult {
  ok: boolean;
  query: string;
  /** Expanded search terms used in the FTS lookup (for UI transparency). */
  expandedTerms: string[];
  playbook: TechnicianPlaybook;
  kbsUsed: KbUsed[];
  /** Per-KB score breakdown for UI ranking transparency. */
  kbsScoreBreakdown: KbScoreEntry[];
  source: 'local_ai' | 'deterministic_fallback';
  localAiUsed: boolean;
  deterministicFallback: boolean;
  kbsFound: number;
  error?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TOP_K_DEFAULT = 5;
const TOP_K_MIN = 3;
const MAX_CONTEXT_ARTICLES = 5;
const KB_RAG_CACHE_TTL_SECONDS = 300; // 5 min

// Snippet limits per article (never full KB)
const MAX_SYMPTOMS_PER_ARTICLE = 3;
const MAX_STEPS_PER_ARTICLE = 3;
const MAX_CHECKLIST_PER_ARTICLE = 3;

/**
 * Deterministic Ollama options for focused, reproducible responses.
 * Per MODEL_CONFIG spec: temperature=0.2, top_p=0.9, repeat_penalty=1.1.
 */
const OLLAMA_RAG_OPTIONS: OllamaGenerationOptions = {
  temperature: 0.2,
  topP: 0.9,
  repeatPenalty: 1.1,
};

const SAFETY_WARNINGS_ALWAYS = [
  'Valide cada comando sugerido com o técnico responsável antes de executar.',
  'Nunca execute comandos destrutivos sem backup e autorização explícita.',
  'Não envie esta resposta ao cliente — é para uso interno do técnico.',
  'Consulte a KB completa caso precise de detalhes adicionais.',
  'Ações que requerem aprovação humana estão marcadas no playbook.',
];

// ── PII Guard ─────────────────────────────────────────────────────────────────

const PII_PATTERNS: Array<[RegExp, string]> = [
  [/(?:\+55\s*)?(?:\(?\d{2}\)?\s*)?\d{4,5}[\s.-]?\d{4}\b/g, '[TELEFONE]'],
  [/\b[\w.+-]+@[\w-]+\.[\w.]+\b/gi, '[EMAIL]'],
  [/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[CPF]'],
  [/\b\d{2}\.?\d{3}\.?\d{3}[/\\]?\d{4}-?\d{2}\b/g, '[CNPJ]'],
  [/(?:token|senha|password|secret|api[_-]?key|bearer)\s*[:=]?\s*["']?\S{8,}["']?/gi, '[CREDENCIAL]'],
];

export function piiGuard(text: string): string {
  let result = text;
  for (const [pattern, replacement] of PII_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function boundedList(arr: string[], max: number): string[] {
  return arr.filter(Boolean).slice(0, max);
}

function sha256Hex(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(31, h) + str.charCodeAt(i) | 0;
  }
  return Math.abs(h).toString(16).padStart(8, '0');
}

function scoreBreakdownToEntry(
  id: number,
  title: string,
  breakdown: KbScoreBreakdown,
): KbScoreEntry {
  return {
    id,
    title,
    totalScore: breakdown.total,
    breakdown: {
      lexicalScore: breakdown.lexicalScore,
      symptomsMatch: breakdown.symptomsMatch,
      aiHintMatch: breakdown.aiHintMatch,
      tagsMatch: breakdown.tagsMatch,
      titleMatch: breakdown.titleMatch,
      contextBoost: breakdown.contextBoost,
    },
  };
}

// ── MASTER_PROMPT (senior analyst, 10 mandatory sections) ────────────────────
//
// Adopted from MASTER_PROMPT spec (integaglpi_local_kb_rag_model_query_expansion_adendum_001).
// Combined with SYSTEM_ROLE from adendo_pipeline_qdrant_001.

const MASTER_PROMPT_SYSTEM = `Você é um analista técnico de nível sênior.

Use apenas as KBs recuperadas no contexto.
Nunca invente comandos, causas ou soluções fora das fontes.
Se as KBs forem insuficientes, diga exatamente o que falta.
A resposta é para o técnico revisar, não para o cliente.

Fluxo obrigatório (responda com JSON contendo TODAS estas chaves):
 1. "resumo_do_incidente"                : string  — 1-2 frases resumindo o incidente
 2. "sintomas_identificados"             : string[] — sintomas observados
 3. "hipoteses_por_camada"               : string[] — hipóteses por camada: rede, servidor, aplicação, identidade, backup, segurança
 4. "perguntas_de_triagem"               : string[] — perguntas para o usuário
 5. "verificacoes_ou_comandos_sugeridos" : string[] — verificações e comandos (sugestão — execução manual)
 6. "causas_possiveis"                   : string[] — causas ordenadas por probabilidade
 7. "resolucao_sugerida"                 : string[] — passos de resolução em ordem
 8. "validacao"                          : string[] — como confirmar que o problema foi resolvido
 9. "escalonamento"                      : string[] — quando e como escalar
10. "riscos_rollback"                    : string[] — riscos e como reverter se algo der errado
11. "nivel_de_confianca"                 : number   — 0 a 1

Regras obrigatórias:
- Nunca responda direto sem diagnóstico.
- Nunca pule validação.
- Nunca execute comandos. Apenas sugira — execução é manual pelo técnico.
- Nunca envie resposta ao cliente.
- Sempre indique quando uma ação exige aprovação humana.
- Sempre priorize segurança e reversibilidade.
- Não inclua dados pessoais: sem nomes, telefones, CPF, e-mails, tokens ou senhas.
- Responda APENAS com JSON válido, sem texto fora do JSON.`;

function buildRagPrompt(query: string, articles: KbCandidateHit[], expandedTerms: string[]): string {
  const safeQuery = piiGuard(query).slice(0, 400);
  const termsNote = expandedTerms.length > 0
    ? `Termos expandidos usados na busca: ${expandedTerms.slice(0, 8).join(', ')}`
    : '';

  // SEARCH_FIELDS → display snippets (title, category, tags, ai_hint, symptoms)
  // OPERATIONAL_FIELDS → display procedure, cause, checklist (only after retrieval)
  const articlesContext = articles
    .slice(0, MAX_CONTEXT_ARTICLES)
    .map((a, i) => {
      const symptoms = boundedList(a.symptomsJson, MAX_SYMPTOMS_PER_ARTICLE);
      const steps = boundedList(a.recommendedProcedureJson, MAX_STEPS_PER_ARTICLE);
      const checks = boundedList(a.checklistJson, MAX_CHECKLIST_PER_ARTICLE);
      const safeHint = piiGuard(a.evidenceSummarySanitized).slice(0, 200);
      const safeCause = piiGuard(a.probableCause).slice(0, 200);

      return [
        `### KB ${i + 1} — ${a.title}`,
        `Categoria: ${a.categorySuggestion}`,
        `Tags: ${a.tagsJson.join(', ').slice(0, 100) || 'N/D'}`,
        `Sintomas: ${symptoms.join('; ') || piiGuard(a.problemPattern).slice(0, 200) || 'N/D'}`,
        `Dica IA: ${safeHint || 'N/D'}`,
        `Causa: ${safeCause || 'N/D'}`,
        `Passos: ${steps.join(' → ') || 'N/D'}`,
        `Validação: ${checks.join(' + ') || 'N/D'}`,
      ].join('\n');
    })
    .join('\n\n---\n\n');

  return [
    MASTER_PROMPT_SYSTEM,
    '',
    '=== CONSULTA DO TÉCNICO ===',
    safeQuery,
    ...(termsNote ? [`(${termsNote})`] : []),
    '',
    '=== KBs RECUPERADAS (use SOMENTE estas) ===',
    articlesContext,
  ].join('\n');
}

// ── Playbook parsers ──────────────────────────────────────────────────────────

function parseJsonPlaybook(raw: string): Partial<TechnicianPlaybook> | null {
  if (!raw?.trim()) return null;
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    const toArray = (v: unknown): string[] => {
      if (Array.isArray(v)) return v.filter((s): s is string => typeof s === 'string').slice(0, 10);
      if (typeof v === 'string' && v !== '') return [v];
      return [];
    };
    const toStr = (v: unknown): string =>
      typeof v === 'string' ? v.slice(0, 2000) : '';
    const toNum = (v: unknown): number => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
    };
    return {
      resumo_do_incidente: toStr(parsed['resumo_do_incidente']),
      sintomas_identificados: toArray(parsed['sintomas_identificados']),
      hipoteses_por_camada: toArray(parsed['hipoteses_por_camada']),
      causas_possiveis: toArray(parsed['causas_possiveis']),
      perguntas_de_triagem: toArray(parsed['perguntas_de_triagem']),
      verificacoes_ou_comandos_sugeridos: toArray(parsed['verificacoes_ou_comandos_sugeridos']),
      resolucao_sugerida: toArray(parsed['resolucao_sugerida']),
      validacao: toArray(parsed['validacao']),
      escalonamento: toArray(parsed['escalonamento']),
      riscos_rollback: toArray(parsed['riscos_rollback']),
      nivel_de_confianca: toNum(parsed['nivel_de_confianca']),
    };
  } catch {
    return null;
  }
}

function buildDeterministicPlaybook(
  query: string,
  articles: KbCandidateHit[],
  kbsUsed: KbUsed[],
): TechnicianPlaybook {
  const top = articles[0];
  return {
    resumo_do_incidente: top
      ? `Incidente relacionado a "${top.title}": ${piiGuard(top.problemPattern).slice(0, 200) || top.title}.`
      : 'Incidente não identificado — nenhuma KB com alta relevância encontrada. Consulte manualmente.',
    sintomas_identificados: top
      ? boundedList(top.symptomsJson, 5)
      : ['Sintoma não identificado — revise manualmente.'],
    hipoteses_por_camada: top && top.probableCause
      ? [
          `Camada de aplicação: ${piiGuard(top.probableCause).slice(0, 150) || 'verificar logs do sistema'}.`,
          'Verificar também: rede (conectividade), servidor (recursos), identidade (permissões).',
        ]
      : [
          'Verificar camada de aplicação (logs, erros).',
          'Verificar camada de rede (conectividade, firewall).',
          'Verificar camada de servidor (CPU, memória, disco).',
          'Verificar identidade (AD, permissões, licenças).',
        ],
    causas_possiveis: top && top.probableCause
      ? [piiGuard(top.probableCause).slice(0, 300)]
      : ['Causa não determinada — verifique os artigos relacionados.'],
    perguntas_de_triagem: top
      ? boundedList(top.problemPattern.split(';').map((s) => s.trim()).filter(Boolean), 5)
      : ['Quando o problema começou?', 'Afeta outros usuários?', 'Há mensagem de erro?'],
    verificacoes_ou_comandos_sugeridos: top
      ? boundedList(top.recommendedProcedureJson, 5)
      : ['Verificar logs do sistema.', 'Testar em outra estação/usuário.'],
    resolucao_sugerida: top
      ? boundedList(top.recommendedProcedureJson, 5)
      : ['Consulte o suporte nível 2.'],
    validacao: top
      ? boundedList(top.checklistJson, 5)
      : ['Confirmar com o usuário que o problema foi resolvido.'],
    escalonamento: [
      'Se o problema persistir após os passos acima, escalar para N2.',
      'Registrar evidências (logs, prints, erros) antes de escalar.',
      'Toda ação que exige permissão elevada deve ter aprovação humana antes de executar.',
    ],
    riscos_rollback: top
      ? boundedList(
          top.recommendedProcedureJson.filter((s) =>
            /rollback|reverter|desfazer|backup|restaurar|desinstalar/i.test(s),
          ),
          3,
        )
      : ['Verifique se há backup antes de qualquer alteração.'],
    kbs_utilizadas: kbsUsed,
    nivel_de_confianca: kbsUsed.length > 0 ? Math.max(...kbsUsed.map((k) => k.score)) : 0,
    avisos_de_seguranca: SAFETY_WARNINGS_ALWAYS,
  };
}

function mergePlaybook(
  partial: Partial<TechnicianPlaybook> | null,
  articles: KbCandidateHit[],
  kbsUsed: KbUsed[],
  query: string,
): TechnicianPlaybook {
  const det = buildDeterministicPlaybook(query, articles, kbsUsed);
  if (!partial) return det;

  const safe = (arr: string[] | undefined, fallback: string[]): string[] =>
    arr && arr.length > 0 ? arr : fallback;
  const safeStr = (s: string | undefined, fallback: string): string =>
    s && s.trim() !== '' && s !== 'informação insuficiente na KB.' ? s : fallback;

  return {
    resumo_do_incidente: safeStr(partial.resumo_do_incidente, det.resumo_do_incidente),
    sintomas_identificados: safe(partial.sintomas_identificados, det.sintomas_identificados),
    hipoteses_por_camada: safe(partial.hipoteses_por_camada, det.hipoteses_por_camada),
    causas_possiveis: safe(partial.causas_possiveis, det.causas_possiveis),
    perguntas_de_triagem: safe(partial.perguntas_de_triagem, det.perguntas_de_triagem),
    verificacoes_ou_comandos_sugeridos: safe(partial.verificacoes_ou_comandos_sugeridos, det.verificacoes_ou_comandos_sugeridos),
    resolucao_sugerida: safe(partial.resolucao_sugerida, det.resolucao_sugerida),
    validacao: safe(partial.validacao, det.validacao),
    escalonamento: safe(partial.escalonamento, det.escalonamento),
    riscos_rollback: safe(partial.riscos_rollback, det.riscos_rollback),
    kbs_utilizadas: kbsUsed,
    nivel_de_confianca: partial.nivel_de_confianca ?? det.nivel_de_confianca,
    avisos_de_seguranca: SAFETY_WARNINGS_ALWAYS,
  };
}

// ── Service ───────────────────────────────────────────────────────────────────

export class KbRagCopilotService {
  private readonly queryExpansionService: QueryExpansionService;
  private readonly rankingService: KbRankingService;

  public constructor(
    private readonly searchRepo: KbCandidateSearchRepository,
    private readonly ollamaPort: OllamaRagPort | null,
    private readonly auditPort: RagAuditPort | null,
    private readonly cachePort: KbRagCachePort | null = null,
    queryExpansionService?: QueryExpansionService,
    rankingService?: KbRankingService,
  ) {
    // Share ollamaPort with QueryExpansionService (structurally compatible)
    this.queryExpansionService = queryExpansionService ?? new QueryExpansionService(ollamaPort);
    this.rankingService = rankingService ?? new KbRankingService();
  }

  public async generatePlaybook(input: KbRagInput): Promise<KbRagResult> {
    const rawQuery = String(input.query ?? '').trim();
    if (rawQuery === '') {
      return this.emptyResult('Consulta vazia.');
    }

    // 1. PII guard on raw query
    const safeQuery = piiGuard(rawQuery);
    const queryHash = sha256Hex(safeQuery);

    // 2. Query expansion (deterministic + optional local AI)
    let expansionResult = { terms: [] as string[], ftsQuery: safeQuery, aiEnriched: false };
    try {
      expansionResult = await this.queryExpansionService.expand(safeQuery);
    } catch {
      // Fall through to original query
    }
    const { terms: expandedTerms, ftsQuery } = expansionResult;

    // 3. Query tokens for manual ranking
    const queryTokens = ftsQuery
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 3);

    const topK = Math.max(TOP_K_MIN, Math.min(MAX_CONTEXT_ARTICLES, input.topK ?? TOP_K_DEFAULT));

    // 4. Cache check (keyed by query hash — no PII)
    let hits: KbCandidateHit[] = [];
    let cacheHit = false;
    const cacheKey = `kbrag:search:${queryHash}:${topK}`;

    if (this.cachePort !== null) {
      try {
        const cached = await this.cachePort.get(cacheKey);
        if (cached !== null) {
          const parsed = JSON.parse(cached) as KbCandidateHit[];
          if (Array.isArray(parsed)) { hits = parsed; cacheHit = true; }
        }
      } catch { /* cache miss → fall through */ }
    }

    // 5. DB search (over-fetch for reranking headroom)
    if (!cacheHit) {
      try {
        hits = await this.searchRepo.searchCandidates(ftsQuery, topK * 2);
        if (this.cachePort !== null && hits.length > 0) {
          this.cachePort.set(cacheKey, JSON.stringify(hits), KB_RAG_CACHE_TTL_SECONDS).catch(() => {});
        }
      } catch { hits = []; }
    }

    if (hits.length === 0) {
      return {
        ok: true,
        query: rawQuery,
        expandedTerms,
        playbook: buildDeterministicPlaybook(safeQuery, [], []),
        kbsUsed: [],
        kbsScoreBreakdown: [],
        source: 'deterministic_fallback',
        localAiUsed: false,
        deterministicFallback: true,
        kbsFound: 0,
      };
    }

    // 6. Hybrid reranking
    const ranked = this.rankingService.rankHits(hits, queryTokens, input.clientContext, topK);
    if (ranked.length === 0) {
      return {
        ok: true,
        query: rawQuery,
        expandedTerms,
        playbook: buildDeterministicPlaybook(safeQuery, [], []),
        kbsUsed: [],
        kbsScoreBreakdown: [],
        source: 'deterministic_fallback',
        localAiUsed: false,
        deterministicFallback: true,
        kbsFound: hits.length,
        error: 'no_sufficient_kb',
      };
    }

    const kbsUsed: KbUsed[] = ranked.map(({ hit, breakdown }) => ({
      id: hit.id,
      title: hit.title,
      category: hit.categorySuggestion,
      score: breakdown.total,
    }));

    const kbsScoreBreakdown: KbScoreEntry[] = ranked.map(({ hit, breakdown }) =>
      scoreBreakdownToEntry(hit.id, hit.title, breakdown),
    );

    const articles = ranked.map(({ hit }) => hit);

    // 7. Local AI generation
    let localAiUsed = false;
    let deterministicFallback = false;
    let playbook: TechnicianPlaybook;

    if (this.ollamaPort !== null) {
      try {
        const prompt = buildRagPrompt(safeQuery, articles, expandedTerms);
        const rawResponse = await this.ollamaPort.generateText(prompt, OLLAMA_RAG_OPTIONS);
        const parsed = parseJsonPlaybook(rawResponse);
        playbook = mergePlaybook(parsed, articles, kbsUsed, safeQuery);
        localAiUsed = parsed !== null;
        deterministicFallback = parsed === null;
      } catch {
        playbook = buildDeterministicPlaybook(safeQuery, articles, kbsUsed);
        deterministicFallback = true;
      }
    } else {
      playbook = buildDeterministicPlaybook(safeQuery, articles, kbsUsed);
      deterministicFallback = true;
    }

    // 8. Audit (fire-and-forget)
    if (this.auditPort) {
      this.auditPort.writeRagAudit({
        ticketId: input.ticketId ?? null,
        queryHash,
        kbIdsUsed: kbsUsed.map((k) => k.id),
        rankingScores: kbsUsed.map((k) => k.score),
        source: 'local_kb',
        localAiUsed,
        deterministicFallback,
        technicianId: input.technicianId ?? null,
      }).catch(() => {});
    }

    return {
      ok: true,
      query: rawQuery,
      expandedTerms,
      playbook,
      kbsUsed,
      kbsScoreBreakdown,
      source: localAiUsed ? 'local_ai' : 'deterministic_fallback',
      localAiUsed,
      deterministicFallback,
      kbsFound: hits.length,
    };
  }

  private emptyResult(error: string): KbRagResult {
    return {
      ok: false,
      query: '',
      expandedTerms: [],
      playbook: buildDeterministicPlaybook('', [], []),
      kbsUsed: [],
      kbsScoreBreakdown: [],
      source: 'deterministic_fallback',
      localAiUsed: false,
      deterministicFallback: true,
      kbsFound: 0,
      error,
    };
  }
}
