/**
 * KbRerankerService — Ollama cross-encoder local re-ranker (F2.3).
 *
 * Controlled by `RERANKER_ENABLED` feature flag (default: false).
 *
 * Architecture:
 *   - Input: top-5 RankedKbHit candidates from KbRankingService
 *   - Output: same list, re-ordered by cross-encoder relevance score
 *   - Provider: Ollama local (never cloud, never MariaDB, never external PII exposure)
 *   - Timeout: 1500ms per inference; fallback to original order on timeout/error
 *   - Correlation ID in all error logs
 *
 * Safety invariants:
 *   - No ticket mutation. No command execution. No WhatsApp send.
 *   - Never accesses MariaDB or GLPI directly.
 *   - No cloud provider — local Ollama only.
 *   - Fallback is always the original ranking (no silent failure).
 *   - Score from LLM is normalised to [0, 1]; original breakdown.total preserved.
 *
 * Score policy:
 *   - `rerankerScore`: LLM relevance score for the (query, article) pair, [0, 1].
 *   - Sort key = rerankerScore DESC, ties broken by original breakdown.total.
 *   - When RERANKER_ENABLED=false (caller's responsibility), this service is never called.
 *
 * Phase: integaglpi_v9_kb_quality_001 — F2.3
 */

import { pino } from 'pino';

import type { RankedKbHit } from './KbRankingService.js';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Maximum candidates fed to cross-encoder (matches top-K from ranker). */
const MAX_RERANK_CANDIDATES = 5;

/** Per-inference Ollama timeout in ms — must not block UI. */
const INFERENCE_TIMEOUT_MS = 1500;

/** Prompt template for cross-encoder relevance scoring. */
const RELEVANCE_PROMPT = (query: string, title: string, excerpt: string): string =>
  `You are a relevance judge for a IT support knowledge base.
Query: "${query}"
Article title: "${title}"
Article excerpt: "${excerpt.slice(0, 300)}"
Rate the relevance of this article to the query from 0.0 (irrelevant) to 1.0 (perfectly relevant).
Reply with ONLY a decimal number between 0.0 and 1.0. No explanation.`;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RerankedKbHit extends RankedKbHit {
  /**
   * Cross-encoder relevance score from Ollama [0, 1].
   * Null when Ollama timed out or returned unparseable output.
   */
  rerankerScore: number | null;
  /** True when this candidate was re-ranked by LLM, false = fallback order. */
  reranked: boolean;
}

export interface RerankerResult {
  hits: RerankedKbHit[];
  /** True when at least one inference succeeded and order may have changed. */
  reranked: boolean;
  /** True when Ollama was unreachable or all inferences timed out. */
  ollamaUnavailable: boolean;
  /** Latency of slowest successful inference (ms). Null if none succeeded. */
  maxInferenceMs: number | null;
}

// ── Service ───────────────────────────────────────────────────────────────────

export class KbRerankerService {
  private readonly logger = pino({ name: 'KbRerankerService' });
  private readonly ollamaPort: number;
  private readonly model: string;
  private readonly baseUrl: string;

  /**
   * @param ollamaPort  Ollama port (default 11434). Null = service instantiated
   *                    but will always return fallback (used in unit tests).
   * @param model       Ollama model to use. Default: 'qwen3.6:latest'.
   * @param baseUrl     Optional full Ollama base URL (runtime wiring — HML may
   *                    use a non-loopback host). When set, takes precedence over
   *                    ollamaPort for URL construction. '' / null keeps the
   *                    legacy 127.0.0.1:<port> behavior intact.
   */
  constructor(ollamaPort: number | null = 11434, model = 'qwen3.6:latest', baseUrl: string | null = null) {
    this.ollamaPort = ollamaPort ?? 0;
    this.model = model;
    const trimmed = (baseUrl ?? '').trim().replace(/\/+$/, '');
    this.baseUrl = trimmed !== ''
      ? trimmed
      : (this.ollamaPort > 0 ? `http://127.0.0.1:${this.ollamaPort}` : '');
  }

  /** R2 (observabilidade): nome do modelo local — metadado não sensível. */
  public get modelName(): string {
    return this.model;
  }

  /**
   * Re-rank up to MAX_RERANK_CANDIDATES hits using a local cross-encoder.
   *
   * @param hits          Ordered list from KbRankingService (already filtered, topK applied).
   * @param query         Original normalised query string.
   * @param correlationId Request correlation ID for structured log tracing.
   * @returns             RerankerResult with re-ordered hits (or fallback if Ollama unavailable).
   */
  public async rerank(
    hits: RankedKbHit[],
    query: string,
    correlationId: string,
  ): Promise<RerankerResult> {
    if (!hits.length) {
      return this.buildFallback(hits, correlationId, false);
    }

    const candidates = hits.slice(0, MAX_RERANK_CANDIDATES);
    const rest = hits.slice(MAX_RERANK_CANDIDATES);

    if (this.baseUrl === '') {
      // Instantiated with null port and no baseUrl (test mode) — always fallback
      this.logger.debug({ correlationId }, 'KbRerankerService: no Ollama endpoint, returning fallback');
      return this.buildFallback(hits, correlationId, false);
    }

    const inferences = await Promise.all(
      candidates.map((hit, idx) => this.score(hit, query, idx, correlationId)),
    );

    const allFailed = inferences.every((r) => r.score === null);
    const ollamaUnavailable = inferences.every((r) => r.unavailable);

    if (allFailed) {
      this.logger.warn(
        { correlationId, ollamaUnavailable },
        'KbRerankerService: all inferences failed — fallback to original order',
      );
      return this.buildFallback(hits, correlationId, ollamaUnavailable);
    }

    const maxInferenceMs = inferences
      .map((r) => r.elapsedMs)
      .reduce((max, ms) => (ms > max ? ms : max), 0);

    // Sort: score DESC (nulls last), then original breakdown.total DESC
    const sorted: RerankedKbHit[] = inferences
      .map((r) => ({
        hit: r.hit.hit,
        breakdown: r.hit.breakdown,
        rerankerScore: r.score,
        reranked: r.score !== null,
      }))
      .sort((a, b) => {
        if (a.rerankerScore !== null && b.rerankerScore !== null) {
          return b.rerankerScore - a.rerankerScore;
        }
        if (a.rerankerScore !== null) return -1;
        if (b.rerankerScore !== null) return 1;
        return b.breakdown.total - a.breakdown.total;
      });

    // Append candidates beyond MAX_RERANK_CANDIDATES (never re-ranked)
    const allHits: RerankedKbHit[] = [
      ...sorted,
      ...rest.map((h) => ({
        hit: h.hit,
        breakdown: h.breakdown,
        rerankerScore: null,
        reranked: false,
      })),
    ];

    this.logger.debug(
      { correlationId, reranked: sorted.filter((h) => h.reranked).length, maxInferenceMs },
      'KbRerankerService: re-ranking complete',
    );

    return {
      hits: allHits,
      reranked: true,
      ollamaUnavailable: false,
      maxInferenceMs,
    };
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private async score(
    hit: RankedKbHit,
    query: string,
    idx: number,
    correlationId: string,
  ): Promise<{ hit: RankedKbHit; score: number | null; elapsedMs: number; unavailable: boolean }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), INFERENCE_TIMEOUT_MS);
    const start = performance.now();

    const excerpt = [
      hit.hit.problemPattern,
      ...hit.hit.symptomsJson.slice(0, 3),
      hit.hit.evidenceSummarySanitized,
    ]
      .filter(Boolean)
      .join(' ');

    const prompt = RELEVANCE_PROMPT(query, hit.hit.title, excerpt);

    try {
      const resp = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, prompt, stream: false }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const elapsedMs = Math.round(performance.now() - start);

      if (!resp.ok) {
        this.logger.warn(
          { correlationId, candidateIdx: idx, status: resp.status, elapsedMs },
          'KbRerankerService: Ollama HTTP error',
        );
        return { hit, score: null, elapsedMs, unavailable: false };
      }

      const data = (await resp.json()) as { response?: string };
      const parsed = parseFloat(data.response?.trim() ?? '');
      const score = isNaN(parsed) ? null : Math.max(0, Math.min(1, parsed));

      if (score === null) {
        this.logger.warn(
          { correlationId, candidateIdx: idx, rawResponse: data.response?.slice(0, 40), elapsedMs },
          'KbRerankerService: unparseable LLM score',
        );
      }

      return { hit, score, elapsedMs, unavailable: false };
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      const elapsedMs = Math.round(performance.now() - start);
      const isAbort = err instanceof Error && err.name === 'AbortError';
      const isConnect =
        err instanceof Error &&
        (err.message.includes('ECONNREFUSED') || err.message.includes('ENOTFOUND'));

      this.logger.warn(
        { correlationId, candidateIdx: idx, elapsedMs, isAbort, isConnect },
        `KbRerankerService: inference ${isAbort ? 'timeout' : 'error'}`,
      );

      return { hit, score: null, elapsedMs, unavailable: isConnect };
    }
  }

  private buildFallback(
    hits: RankedKbHit[],
    correlationId: string,
    ollamaUnavailable: boolean,
  ): RerankerResult {
    this.logger.debug({ correlationId, ollamaUnavailable }, 'KbRerankerService: fallback result');
    return {
      hits: hits.map((h) => ({
        hit: h.hit,
        breakdown: h.breakdown,
        rerankerScore: null,
        reranked: false,
      })),
      reranked: false,
      ollamaUnavailable,
      maxInferenceMs: null,
    };
  }
}
