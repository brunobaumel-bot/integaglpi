/**
 * SmartHelpService — unified, low-friction, LOCAL-FIRST assistive flow.
 *
 * Contract (both 004 prompts):
 *  1. Always search the native GLPI KB locally first.
 *  2. If a result clears the high-confidence threshold (>= 0.80), return it.
 *  3. If not, OFFER cloud research — but NEVER invoke the cloud here. Cloud is
 *     only ever triggered by a separate, explicit human click downstream.
 *  4. Always non-blocking and read-only: no ticket mutation, no auto-send.
 *
 * This service performs NO cloud call. It returns a cloudOffer flag that the UI
 * uses to show a second "Pesquisar fora" button.
 */

export const SMART_HELP_HIGH_CONFIDENCE = 0.80;
const MAX_RELATED_ARTICLES = 3;
const MAX_SUGGESTED_QUESTIONS = 3;
const MAX_CHECKLIST_ITEMS = 3;

export interface KbSearchHit {
  /** Internal candidate id (if from candidates) — else null. */
  kbCandidateId: number | null;
  /** Native GLPI knowbaseitem id (if a published article) — else null. */
  glpiKnowbaseitemId: number | null;
  title: string;
  category: string;
  excerpt: string;
  /** Raw relevance in [0,1] from the local search (token/category overlap). */
  score: number;
}

/** Port: local KB search. Implemented against native GLPI KB / candidate cache. */
export interface KbSearchPort {
  searchNativeKb(query: string, limit: number): Promise<KbSearchHit[]>;
}

/** Optional port: feedback-driven ranking bias (FeedbackService). */
export interface RankingBiasPort {
  getRankingBias(target: { kbCandidateId?: number | null; glpiKnowbaseitemId?: number | null }): Promise<number>;
}

export interface SmartHelpInput {
  ticketId: number;
  /** Already-built, sanitized context summary (ticket + recent messages). */
  summary: string;
  category?: string;
}

export interface KbArticleSuggestion {
  kbCandidateId: number | null;
  glpiKnowbaseitemId: number | null;
  title: string;
  category: string;
  excerpt: string;
  /** Final confidence after applying feedback bias, in [0,1]. */
  confidence: number;
}

export interface SmartHelpResult {
  ok: boolean;
  ticketId: number;
  /** True only when a local article cleared SMART_HELP_HIGH_CONFIDENCE. */
  localResolved: boolean;
  bestArticle: KbArticleSuggestion | null;
  relatedArticles: KbArticleSuggestion[];
  checklist: string[];
  suggestedQuestions: string[];
  /** Cloud is offered only when local did not resolve. Never auto-invoked. */
  cloudOffer: { available: boolean; reason: string };
  /** Invariant: ALWAYS false here. Cloud requires a separate explicit human click. */
  cloudInvoked: false;
}

export class SmartHelpService {
  public constructor(
    private readonly kbSearch: KbSearchPort,
    private readonly rankingBias?: RankingBiasPort,
  ) {}

  public async assist(input: SmartHelpInput): Promise<SmartHelpResult> {
    const ticketId = input.ticketId;
    const summary = String(input.summary ?? '').trim();
    const category = String(input.category ?? '').trim();

    const checklist = this.buildChecklist(category);
    const suggestedQuestions = this.buildQuestions(category);

    if (summary === '') {
      return {
        ok: true,
        ticketId,
        localResolved: false,
        bestArticle: null,
        relatedArticles: [],
        checklist,
        suggestedQuestions,
        cloudOffer: { available: false, reason: 'Contexto insuficiente para busca.' },
        cloudInvoked: false,
      };
    }

    let hits: KbSearchHit[] = [];
    try {
      hits = await this.kbSearch.searchNativeKb(`${category} ${summary}`.trim(), MAX_RELATED_ARTICLES * 3);
    } catch {
      hits = [];
    }

    // Apply feedback-driven ranking bias (helpful articles surface earlier).
    const ranked = await this.applyBias(hits);
    ranked.sort((a, b) => b.confidence - a.confidence);

    const related = ranked.slice(0, MAX_RELATED_ARTICLES);
    const best = related[0] ?? null;
    const localResolved = best !== null && best.confidence >= SMART_HELP_HIGH_CONFIDENCE;

    return {
      ok: true,
      ticketId,
      localResolved,
      bestArticle: localResolved ? best : null,
      relatedArticles: related,
      checklist,
      suggestedQuestions,
      cloudOffer: localResolved
        ? { available: false, reason: 'Artigo local com alta confiança encontrado.' }
        : { available: true, reason: 'Nenhum artigo local com alta confiança. Pesquisa externa disponível sob clique.' },
      cloudInvoked: false,
    };
  }

  private async applyBias(hits: KbSearchHit[]): Promise<KbArticleSuggestion[]> {
    const out: KbArticleSuggestion[] = [];
    for (const hit of hits) {
      let confidence = clamp01(hit.score);
      if (this.rankingBias) {
        try {
          const bias = await this.rankingBias.getRankingBias({
            kbCandidateId: hit.kbCandidateId,
            glpiKnowbaseitemId: hit.glpiKnowbaseitemId,
          });
          // bias in [0.5,1.5] nudges the score but never above 1 or below 0.
          confidence = clamp01(hit.score * bias);
        } catch {
          confidence = clamp01(hit.score);
        }
      }
      out.push({
        kbCandidateId: hit.kbCandidateId,
        glpiKnowbaseitemId: hit.glpiKnowbaseitemId,
        title: hit.title,
        category: hit.category,
        excerpt: hit.excerpt,
        confidence: Number(confidence.toFixed(4)),
      });
    }
    return out;
  }

  private buildChecklist(category: string): string[] {
    const base = [
      'Confirmar com o usuário o sintoma exato e quando começou.',
      'Verificar se o problema é isolado ou afeta mais usuários/estações.',
      'Reproduzir o cenário e registrar evidências objetivas no chamado.',
    ];
    return base.slice(0, MAX_CHECKLIST_ITEMS);
  }

  private buildQuestions(category: string): string[] {
    const base = [
      'Quando o problema começou e o que mudou antes disso?',
      'O problema acontece sempre ou de forma intermitente?',
      'Qual a mensagem de erro exata (se houver) que aparece na tela?',
    ];
    return base.slice(0, MAX_SUGGESTED_QUESTIONS);
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}
