/**
 * KB Enrichment CLI — execução controlada do enriquecimento de KBs.
 * Phase: integaglpi_v9_kb_enrichment_and_search_optimization_001 (aplicação autorizada)
 *
 * Uso (dentro do container, com KB_ENRICHMENT_ENABLED=true no ambiente do processo):
 *   node dist/kbEnrichment/cli.js --limit 10 --dry-run     # gera drafts, NÃO grava
 *   node dist/kbEnrichment/cli.js --limit 10 --apply       # enriquece e APLICA (backup automático)
 *   node dist/kbEnrichment/cli.js --gaps --window-days 30  # persiste lacunas como draft_gap_candidate
 *   node dist/kbEnrichment/cli.js --rollback <id>          # reverte um candidato enriquecido
 *
 * Invariantes: batch limitado (1..50); original sempre em backup; sem cloud;
 * sem WhatsApp; sem ticket; sem publicação de KB GLPI nativa.
 */

import { readFileSync } from 'node:fs';

import { postgresPool } from '../infra/db/postgres.js';
import { env } from '../config/env.js';
import { OllamaClient } from '../ai/OllamaClient.js';
import { KbEnrichmentService } from '../domain/services/KbEnrichmentService.js';
import { PostgresKbCandidateSearchRepository } from '../repositories/postgres/PostgresKbCandidateSearchRepository.js';

interface CliOptions {
  limit: number;
  apply: boolean;
  dryRun: boolean;
  gaps: boolean;
  all: boolean;
  generateCandidates: boolean;
  windowDays: number;
  rollbackId: number | null;
  allowDeterministic: boolean;
  maxVersion: number;
  bundleFile: string | null;
  applyAgentAll: boolean;
  applyAgentQuality: boolean;
  contentRewriteIds: number[];
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    limit: 10,
    apply: false,
    dryRun: false,
    gaps: false,
    all: false,
    generateCandidates: false,
    windowDays: 30,
    rollbackId: null,
    allowDeterministic: false,
    maxVersion: 1,
    bundleFile: null,
    applyAgentAll: false,
    applyAgentQuality: false,
    contentRewriteIds: [],
  };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--apply-content-rewrite':
        options.apply = true;
        break;
      case '--all':
        options.all = true;
        break;
      case '--format-16-sections':
      case '--backup-originals':
        // Explicit contract flags for operators; behavior is already enforced by
        // KbContentRewriteService + applyEnrichedContent original_backup.
        break;
      case '--generate-candidates':
        options.generateCandidates = true;
        options.gaps = true;
        break;
      case '--ids':
        options.contentRewriteIds = (args[++i] ?? '')
          .split(',')
          .map((v) => Number.parseInt(v.trim(), 10))
          .filter((n) => Number.isFinite(n) && n > 0);
        break;
      case '--apply-agent-all':
        options.applyAgentAll = true;
        options.apply = true;
        break;
      case '--apply-agent-quality':
        options.applyAgentQuality = true;
        options.apply = true;
        break;
      case '--bundle-file':
        options.bundleFile = args[++i] ?? null;
        break;
      case '--allow-deterministic':
        options.allowDeterministic = true;
        break;
      case '--max-version':
        options.maxVersion = Math.max(1, Math.min(5, Number.parseInt(args[++i] ?? '1', 10) || 1));
        break;
      case '--limit':
        options.limit = Math.max(1, Math.min(50, Number.parseInt(args[++i] ?? '10', 10) || 10));
        break;
      case '--apply':
        options.apply = true;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--gaps':
        options.gaps = true;
        break;
      case '--window-days':
        options.windowDays = Math.max(1, Math.min(90, Number.parseInt(args[++i] ?? '30', 10) || 30));
        break;
      case '--rollback':
        options.rollbackId = Number.parseInt(args[++i] ?? '0', 10) || null;
        break;
      default:
        throw new Error(`Argumento desconhecido: ${args[i]}`);
    }
  }
  if (!options.apply && !options.dryRun && !options.gaps && options.rollbackId === null && options.bundleFile === null && !options.applyAgentAll && !options.applyAgentQuality && options.contentRewriteIds.length === 0) {
    throw new Error('Informe --dry-run, --apply, --apply-agent-all, --apply-agent-quality, --apply-content-rewrite --ids, --gaps, --rollback <id> ou --bundle-file <path>.');
  }
  if (options.all && !options.apply) {
    throw new Error('--all só é aceito com uma ação explícita de aplicação.');
  }
  return options;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  const repo = new PostgresKbCandidateSearchRepository(postgresPool);
  const ollamaBaseUrl = env.AI_SUPERVISOR_BASE_URL.trim();
  const model = (process.env['KB_RAG_MODEL'] ?? '').trim()
    || (env.COPILOT_DRAFT_MODEL.trim() !== '' ? env.COPILOT_DRAFT_MODEL.trim() : env.AI_SUPERVISOR_MODEL);
  const ollama = ollamaBaseUrl !== '' && env.KB_ENRICHMENT_ENABLED
    ? new OllamaClient(ollamaBaseUrl, model, Math.max(30_000, Number(process.env['KB_ENRICH_TIMEOUT_MS'] ?? 60_000)))
    : null;

  const service = new KbEnrichmentService(ollama, postgresPool);

  console.log(JSON.stringify({
    mode: options.rollbackId !== null ? 'rollback' : options.gaps ? 'gaps' : options.apply ? 'apply' : 'dry-run',
    kb_enrichment_enabled: env.KB_ENRICHMENT_ENABLED,
    ollama: ollama !== null ? 'configured' : 'disabled (deterministico)',
    model: ollama !== null ? model : null,
    limit: options.limit,
  }));

  if (options.rollbackId !== null) {
    const ok = await repo.rollbackEnrichment(options.rollbackId);
    console.log(JSON.stringify({ rollback_id: options.rollbackId, ok }));
    return;
  }

  if (options.contentRewriteIds.length > 0) {
    const summary = await service.applyContentRewriteBatch(repo, options.contentRewriteIds.slice(0, 50));
    for (const item of summary.items) {
      console.log(JSON.stringify(item));
    }
    console.log(JSON.stringify({ mode: 'apply-content-rewrite', ...summary }));
    return;
  }

  if (options.apply && options.all) {
    const summary = await service.applyContentRewriteAll(repo, options.limit);
    console.log(JSON.stringify({ mode: 'apply-content-rewrite-all', ...summary }));
    return;
  }

  if (options.applyAgentQuality) {
    const summary = await service.applyAgentQualityRewriteAll(repo, options.limit);
    console.log(JSON.stringify({ mode: 'apply-agent-quality', ...summary }));
    return;
  }

  if (options.applyAgentAll) {
    const summary = await service.applyAgentEnrichmentAll(repo, options.limit, options.maxVersion);
    console.log(JSON.stringify({ mode: 'apply-agent-all', ...summary }));
    return;
  }

  if (options.bundleFile !== null) {
    const raw = readFileSync(options.bundleFile, 'utf8');
    const records = JSON.parse(raw) as unknown;
    if (!Array.isArray(records)) {
      throw new Error('Bundle deve ser JSON array.');
    }
    const summary = await service.applyAgentBundle(repo, records as never);
    for (const item of summary.items) {
      console.log(JSON.stringify(item));
    }
    console.log(JSON.stringify({
      processed: summary.processed,
      applied: summary.applied,
      failed: summary.failed,
      mode: 'agent-bundle',
    }));
    return;
  }

  if (options.gaps) {
    const result = await service.persistGapCandidates(repo, options.windowDays);
    console.log(JSON.stringify({
      mode: options.generateCandidates ? 'gaps-generate-candidates' : 'gaps',
      gap_analysis: result,
    }));
    return;
  }

  if (options.dryRun) {
    const candidates = await repo.listCandidatesForEnrichment(options.limit, 0, options.maxVersion);
    for (const hit of candidates) {
      const result = await service.buildEnrichedDraft(hit);
      console.log(JSON.stringify({
        id: hit.id,
        title: hit.title.slice(0, 70),
        gaps: result.gaps_detected.length,
        status: result.status,
        original_hash: result.original_hash.slice(0, 12),
        enriched_hash: result.enriched_hash.slice(0, 12),
        dry_run: true,
      }));
    }
    console.log(JSON.stringify({ dry_run_total: candidates.length, applied: 0 }));
    return;
  }

  // --apply
  const summary = await service.enrichAndApplyBatch(repo, options.limit, {
    allowDeterministic: options.allowDeterministic,
    maxVersion: options.maxVersion,
  });
  for (const item of summary.items) {
    console.log(JSON.stringify(item));
  }
  console.log(JSON.stringify({
    processed: summary.processed,
    applied: summary.applied,
    failed: summary.failed,
  }));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    process.exit(1);
  });
