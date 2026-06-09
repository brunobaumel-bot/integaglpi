/**
 * KB RAGAS Telemetry Harness (F2.1)
 *
 * Gerador de relatório RAGAS-style offline.
 * Roda como script standalone — NÃO como teste vitest.
 *
 * Regras obrigatórias:
 *   - NUNCA bloqueia CI (exit 0 sempre, exceto erro de escrita em disco)
 *   - Timeout por inferência Ollama: 1500ms → telemetry_status: 'failed_timeout'
 *   - Baseline NUNCA atualizado automaticamente — só por commit manual
 *   - Sem assert exato em métricas LLM (não-determinísticas)
 *   - Relatório em docs/eval_reports/ragas_YYYY-MM-DD.json
 *
 * Uso:
 *   npx tsx tests/kbRagasHarness.ts [--ollama-port=11434] [--output=path/to/out.json]
 *
 * Phase: integaglpi_v9_kb_quality_001 — F2.1
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { KbSearchPlannerService } from '../src/domain/services/KbSearchPlannerService.js';
import { KbRankingService } from '../src/domain/services/KbRankingService.js';
import {
  GOLDEN_SET,
  GOLDEN_SET_META,
  type GoldenSetQuery,
} from './fixtures/kbGoldenSetFixtures.js';

// ── Config ────────────────────────────────────────────────────────────────────

const TIMEOUT_MS_PER_INFERENCE = 1500;
const EVAL_REPORTS_DIR = join(process.cwd(), '..', 'docs', 'eval_reports');
const BASELINE_PATH = join(EVAL_REPORTS_DIR, 'baseline.json');

const args = process.argv.slice(2);
const ollamaPortArg = args.find((a) => a.startsWith('--ollama-port='));
const outputArg = args.find((a) => a.startsWith('--output='));

const ollamaPort = ollamaPortArg
  ? parseInt(ollamaPortArg.replace('--ollama-port=', ''), 10)
  : 11434;

const today = new Date().toISOString().slice(0, 10);
const defaultOutput = join(EVAL_REPORTS_DIR, `ragas_${today}.json`);
const outputPath = outputArg ? outputArg.replace('--output=', '') : defaultOutput;

// ── Types ─────────────────────────────────────────────────────────────────────

interface QueryResult {
  id: string;
  query: string;
  product_detected: string | null;
  source_tier_in_plan: string[];
  minimum_confidence: number;
  plan_source: string;
  faithfulness_score: number | null;
  telemetry_status: 'ok' | 'failed_timeout' | 'failed_error' | 'ollama_unavailable';
  elapsed_ms: number;
  error?: string;
}

interface RagasReport {
  schema_version: string;
  phase: string;
  deliverable: string;
  generated_at: string;
  ollama_port: number;
  golden_set_version: string;
  total_queries: number;
  results_summary: {
    ok: number;
    failed_timeout: number;
    failed_error: number;
    ollama_unavailable: number;
  };
  /**
   * RAGAS-style metrics (non-blocking — compare against baseline with tolerance).
   * NÃO usar para assert exato — são não-determinísticas.
   */
  metrics: {
    /** % de queries onde product_detected está correto. Determinístico. */
    product_detection_rate: number;
    /** % de queries onde source_tier_in_plan contém o tier esperado. Determinístico. */
    tier_coverage_rate: number;
    /** Faithfulness score médio (LLM-based — não-determinístico). Null se Ollama indisponível. */
    avg_faithfulness: number | null;
    /** Quantidade de queries que retornaram Ollama score. */
    faithfulness_sample_size: number;
  };
  baseline_comparison: {
    baseline_found: boolean;
    baseline_path: string;
    tier_coverage_delta: number | null;
    product_detection_delta: number | null;
    avg_faithfulness_delta: number | null;
    within_tolerance: boolean | null;
    tolerance_thresholds: {
      tier_coverage_min: number;
      product_detection_min: number;
      faithfulness_max_drop: number;
    };
  };
  results: QueryResult[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function ollamaFaithfulness(
  query: string,
  expectedProduct: string | null,
  port: number,
): Promise<{ score: number; status: QueryResult['telemetry_status']; elapsed_ms: number }> {
  const prompt = expectedProduct
    ? `Rate from 0 to 1 how well this query "${query}" relates to the product "${expectedProduct}". Reply with only a number between 0 and 1.`
    : `Rate from 0 to 1 how generic this support query is (1=very generic): "${query}". Reply with only a number between 0 and 1.`;

  const start = performance.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS_PER_INFERENCE);

  try {
    const resp = await fetch(`http://127.0.0.1:${port}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'qwen3.6:latest', prompt, stream: false }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const elapsed_ms = Math.round(performance.now() - start);

    if (!resp.ok) {
      return { score: 0, status: 'failed_error', elapsed_ms };
    }
    const data = (await resp.json()) as { response?: string };
    const parsed = parseFloat(data.response?.trim() ?? '');
    const score = isNaN(parsed) ? 0 : Math.max(0, Math.min(1, parsed));
    return { score, status: 'ok', elapsed_ms };
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    const elapsed_ms = Math.round(performance.now() - start);
    const isAbort = err instanceof Error && err.name === 'AbortError';
    const isConnect = err instanceof Error && (err.message.includes('ECONNREFUSED') || err.message.includes('ENOTFOUND'));
    return {
      score: 0,
      status: isAbort ? 'failed_timeout' : isConnect ? 'ollama_unavailable' : 'failed_error',
      elapsed_ms,
    };
  }
}

function loadBaseline(): RagasReport['metrics'] | null {
  if (!existsSync(BASELINE_PATH)) return null;
  try {
    const raw = readFileSync(BASELINE_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as { metrics?: RagasReport['metrics'] };
    return parsed.metrics ?? null;
  } catch {
    return null;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`[ragas] Golden set: ${GOLDEN_SET.length} queries`);
  console.log(`[ragas] Ollama port: ${ollamaPort}`);
  console.log(`[ragas] Output: ${outputPath}`);

  const planner = new KbSearchPlannerService(ollamaPort);
  const results: QueryResult[] = [];

  for (const fixture of GOLDEN_SET as readonly GoldenSetQuery[]) {
    const start = performance.now();
    let faithfulness: { score: number; status: QueryResult['telemetry_status']; elapsed_ms: number } | null = null;

    try {
      const plan = await planner.buildPlan(fixture.query, fixture.clientContext ?? undefined);

      faithfulness = await ollamaFaithfulness(
        fixture.query,
        fixture.expected.product,
        ollamaPort,
      );

      results.push({
        id: fixture.id,
        query: fixture.query,
        product_detected: plan.productOrSystem,
        source_tier_in_plan: plan.sourceTiersAllowed,
        minimum_confidence: plan.minimumConfidence,
        plan_source: plan.planSource,
        faithfulness_score: faithfulness.score,
        telemetry_status: faithfulness.status,
        elapsed_ms: Math.round(performance.now() - start),
      });
    } catch (err: unknown) {
      results.push({
        id: fixture.id,
        query: fixture.query,
        product_detected: null,
        source_tier_in_plan: [],
        minimum_confidence: 0,
        plan_source: 'error',
        faithfulness_score: null,
        telemetry_status: 'failed_error',
        elapsed_ms: Math.round(performance.now() - start),
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ── Compute metrics ─────────────────────────────────────────────────────────

  const goldSet = GOLDEN_SET as readonly GoldenSetQuery[];

  const productOk = results.filter((r, i) => {
    const expected = goldSet[i]!.expected.product;
    return expected === null ? r.product_detected === null : r.product_detected === expected;
  }).length;

  const tierOk = results.filter((r, i) => {
    return r.source_tier_in_plan.includes(goldSet[i]!.expected.source_tier);
  }).length;

  const faithfulnessSamples = results.filter(
    (r) => r.faithfulness_score !== null && r.telemetry_status === 'ok',
  );
  const avgFaithfulness =
    faithfulnessSamples.length > 0
      ? faithfulnessSamples.reduce((sum, r) => sum + (r.faithfulness_score ?? 0), 0) /
        faithfulnessSamples.length
      : null;

  const metrics: RagasReport['metrics'] = {
    product_detection_rate: Number((productOk / results.length).toFixed(4)),
    tier_coverage_rate: Number((tierOk / results.length).toFixed(4)),
    avg_faithfulness: avgFaithfulness !== null ? Number(avgFaithfulness.toFixed(4)) : null,
    faithfulness_sample_size: faithfulnessSamples.length,
  };

  // ── Baseline comparison ─────────────────────────────────────────────────────

  const TOLERANCES = {
    tier_coverage_min: 0.75,
    product_detection_min: 0.70,
    faithfulness_max_drop: 0.05,
  };

  const baseline = loadBaseline();
  let baselineComparison: RagasReport['baseline_comparison'];

  if (baseline) {
    const tierDelta = metrics.tier_coverage_rate - baseline.tier_coverage_rate;
    const productDelta = metrics.product_detection_rate - baseline.product_detection_rate;
    const faithDelta =
      metrics.avg_faithfulness !== null && baseline.avg_faithfulness !== null
        ? metrics.avg_faithfulness - baseline.avg_faithfulness
        : null;

    const withinTolerance =
      metrics.tier_coverage_rate >= TOLERANCES.tier_coverage_min &&
      metrics.product_detection_rate >= TOLERANCES.product_detection_min &&
      (faithDelta === null || faithDelta >= -TOLERANCES.faithfulness_max_drop);

    baselineComparison = {
      baseline_found: true,
      baseline_path: BASELINE_PATH,
      tier_coverage_delta: Number(tierDelta.toFixed(4)),
      product_detection_delta: Number(productDelta.toFixed(4)),
      avg_faithfulness_delta: faithDelta !== null ? Number(faithDelta.toFixed(4)) : null,
      within_tolerance: withinTolerance,
      tolerance_thresholds: TOLERANCES,
    };

    if (!withinTolerance) {
      console.warn('[ragas] WARNING: métricas fora da tolerância vs baseline.');
      console.warn('[ragas] tier_coverage:', metrics.tier_coverage_rate, '(min:', TOLERANCES.tier_coverage_min, ')');
      console.warn('[ragas] product_detection:', metrics.product_detection_rate, '(min:', TOLERANCES.product_detection_min, ')');
      if (faithDelta !== null) {
        console.warn('[ragas] faithfulness_delta:', faithDelta, '(max_drop:', TOLERANCES.faithfulness_max_drop, ')');
      }
    }
  } else {
    baselineComparison = {
      baseline_found: false,
      baseline_path: BASELINE_PATH,
      tier_coverage_delta: null,
      product_detection_delta: null,
      avg_faithfulness_delta: null,
      within_tolerance: null,
      tolerance_thresholds: TOLERANCES,
    };
    console.log('[ragas] Baseline não encontrado — este run será o primeiro relatório de referência.');
  }

  // ── Build report ────────────────────────────────────────────────────────────

  const summaryCount = (status: QueryResult['telemetry_status']) =>
    results.filter((r) => r.telemetry_status === status).length;

  const report: RagasReport = {
    schema_version: '1.0',
    phase: GOLDEN_SET_META.phase,
    deliverable: GOLDEN_SET_META.deliverable,
    generated_at: new Date().toISOString(),
    ollama_port: ollamaPort,
    golden_set_version: GOLDEN_SET_META.version,
    total_queries: results.length,
    results_summary: {
      ok: summaryCount('ok'),
      failed_timeout: summaryCount('failed_timeout'),
      failed_error: summaryCount('failed_error'),
      ollama_unavailable: summaryCount('ollama_unavailable'),
    },
    metrics,
    baseline_comparison: baselineComparison,
    results,
  };

  // ── Write report ────────────────────────────────────────────────────────────

  if (!existsSync(EVAL_REPORTS_DIR)) {
    mkdirSync(EVAL_REPORTS_DIR, { recursive: true });
  }
  writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`[ragas] Relatório salvo: ${outputPath}`);
  console.log(`[ragas] tier_coverage=${metrics.tier_coverage_rate} | product_detection=${metrics.product_detection_rate} | faithfulness_samples=${metrics.faithfulness_sample_size}`);

  // Exit 0 sempre — NUNCA bloqueia CI
  process.exit(0);
}

// ── Identificar chamada direta vs import ──────────────────────────────────────
// Em ESM, não existe require.main === module. Verificamos via argv.
const isDirectRun = process.argv[1]?.endsWith('kbRagasHarness.ts') ||
  process.argv[1]?.endsWith('kbRagasHarness.js');

if (isDirectRun) {
  main().catch((err: unknown) => {
    console.error('[ragas] Erro fatal não esperado:', err);
    // Mesmo em erro fatal de escrita, exit 0 — CI não quebra por telemetria
    process.exit(0);
  });
}

export { main as runRagasHarness };
