import { readFile, writeFile } from 'node:fs/promises';

import { postgresPool } from '../infra/db/postgres.js';
import { generateKbCandidatesFromHistory } from './generator.js';
import { loadKbCandidateGenerationInput, persistKbCandidates } from './repository.js';
import type { KbCandidateCliOptions, KbCandidateNativeArticle } from './types.js';

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function parseArgs(args: string[]): KbCandidateCliOptions {
  const options: KbCandidateCliOptions = {
    runId: '',
    maxCandidates: 20,
    minConfidence: 65,
    dryRun: false,
  };

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    switch (arg) {
      case '--run-id':
        options.runId = requireValue(args, index, arg);
        index++;
        break;
      case '--max-candidates':
        options.maxCandidates = Math.max(1, Math.min(100, Number.parseInt(requireValue(args, index, arg), 10)));
        index++;
        break;
      case '--min-confidence':
        options.minConfidence = Math.max(1, Math.min(100, Number.parseInt(requireValue(args, index, arg), 10)));
        index++;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--output-summary':
        options.outputSummaryPath = requireValue(args, index, arg);
        index++;
        break;
      case '--native-kb-export':
        options.nativeKbExportPath = requireValue(args, index, arg);
        index++;
        break;
      case '--no-ollama':
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.runId) {
    throw new Error('Missing required --run-id');
  }

  return options;
}

async function loadNativeKbExport(path?: string): Promise<KbCandidateNativeArticle[]> {
  if (!path) {
    return [];
  }
  const raw = await readFile(path, 'utf8');
  const values = raw.trim().startsWith('[')
    ? JSON.parse(raw) as unknown[]
    : raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as unknown);

  return values
    .filter((value): value is Record<string, unknown> => value !== null && typeof value === 'object')
    .map((value) => ({
      articleId: Number(value.article_id ?? value.articleId ?? 0),
      title: String(value.title ?? ''),
      category: String(value.category ?? ''),
      internalUrl: String(value.internal_url ?? value.internalUrl ?? ''),
      excerpt: String(value.excerpt ?? ''),
    }))
    .filter((article) => article.articleId > 0 && article.title !== '');
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const input = await loadKbCandidateGenerationInput(postgresPool, options.runId);
  input.nativeArticles = await loadNativeKbExport(options.nativeKbExportPath);
  const candidates = generateKbCandidatesFromHistory(input, {
    minConfidence: options.minConfidence,
    maxCandidates: options.maxCandidates,
  });
  const inserted = options.dryRun ? 0 : await persistKbCandidates(postgresPool, candidates);
  const summary = {
    run_id: input.runId,
    dry_run: options.dryRun,
    candidates_generated: candidates.length,
    candidates_inserted: inserted,
    low_confidence: candidates.filter((candidate) => candidate.status === 'low_confidence').length,
    possible_duplicate: candidates.filter((candidate) => candidate.possibleDuplicate).length,
  };

  if (options.outputSummaryPath) {
    await writeFile(options.outputSummaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  }

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  await postgresPool.end();
}

main().catch(async (error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  await postgresPool.end().catch(() => undefined);
  process.exitCode = 1;
});
