import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { analyzeHistoricalMiningDataset } from './engine.js';
import { loadHistoricalMiningDataset, validateHistoricalWindow, validateMaxRows } from './input.js';
import type { HistoricalMiningCliOptions } from './types.js';

function readFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) {
    return undefined;
  }
  return args[index + 1];
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function parseOptionalDate(value: string | undefined): Date | undefined {
  if (!value) {
    return undefined;
  }
  return new Date(value);
}

export function parseHistoricalMiningCliArgs(args: string[]): HistoricalMiningCliOptions {
  const inputPath = readFlag(args, '--input');
  if (!inputPath) {
    throw new Error('HISTORICAL_MINING_INPUT_REQUIRED');
  }
  const windowStart = parseOptionalDate(readFlag(args, '--window-start'));
  const windowEnd = parseOptionalDate(readFlag(args, '--window-end'));
  validateHistoricalWindow(windowStart, windowEnd);
  const maxRows = validateMaxRows(Number(readFlag(args, '--max-rows') ?? '1000'));

  return {
    inputPath,
    windowStart,
    windowEnd,
    maxRows,
    dryRun: hasFlag(args, '--dry-run'),
    outputSummaryPath: readFlag(args, '--output-summary'),
  };
}

async function main(): Promise<void> {
  const options = parseHistoricalMiningCliArgs(process.argv.slice(2));
  const dataset = await loadHistoricalMiningDataset(options.inputPath, {
    windowStart: options.windowStart,
    windowEnd: options.windowEnd,
    maxRows: options.maxRows,
  });
  const result = analyzeHistoricalMiningDataset(dataset, {
    windowStart: options.windowStart,
    windowEnd: options.windowEnd,
  });
  const summary = {
    run_id: result.run.runId,
    input_hash: result.run.inputHash,
    dry_run: options.dryRun,
    rows_seen: result.run.rowsSeen,
    rows_processed: result.run.rowsProcessed,
    rows_rejected: result.run.rowsRejected,
    patterns: result.patterns.length,
    insights: result.insights.length,
  };

  if (!options.dryRun) {
    const [{ postgresPool, ensureDatabaseSchema }, { persistHistoricalMiningResult }] = await Promise.all([
      import('../infra/db/postgres.js'),
      import('./repository.js'),
    ]);
    await ensureDatabaseSchema();
    try {
      await persistHistoricalMiningResult(postgresPool, result, 'offline_cli');
    } finally {
      await postgresPool.end();
    }
  }

  if (options.outputSummaryPath) {
    await writeFile(options.outputSummaryPath, `${JSON.stringify({ summary, result }, null, 2)}\n`, 'utf8');
  }

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
