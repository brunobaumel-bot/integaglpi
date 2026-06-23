/**
 * V10 Shadow Replay Lab G10 - manual results reporter CLI.
 *
 * Read-only SELECT on shadow_replay_* tables. JSON default; optional Markdown.
 * Does NOT auto-load .env. Connection URL must be explicit via env var.
 *
 * PHASE: integaglpi_v10_shadow_replay_lab_g10_results_reporter_001
 *
 * Usage:
 *   npx tsc -p tsconfig.shadow-replay.json
 *   SHADOW_REPLAY_REPORT_DATABASE_URL='postgres://...' node scripts/v10ShadowReplayResultsReporter.mjs
 *   SHADOW_REPLAY_REPORT_DATABASE_URL='postgres://...' node scripts/v10ShadowReplayResultsReporter.mjs --format=markdown
 *   node scripts/v10ShadowReplayResultsReporter.mjs --format=json --run-id=shadow-run-g9-smoke-...
 */

import pg from 'pg';

import { ShadowReplayPostgresReader } from '../dist-shadow-replay/ShadowReplayPostgresReader.js';
import {
  generateShadowReplayResultsReportFromStore,
  maskShadowReplayResultsReportForOutput,
  serializeShadowReplayResultsReportJson,
  serializeShadowReplayResultsReportMarkdown,
} from '../dist-shadow-replay/ShadowReplayResultsReporter.js';

const CONNECTION_ENV = 'SHADOW_REPLAY_REPORT_DATABASE_URL';
const PII_VALUE_RE =
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\b(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?(?:9\s?)?\d{4}[-.\s]?\d{4}\b|\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/i;
const SECRET_IN_OUTPUT_RE = /postgres(?:ql)?:\/\/|password\s*=|api[_-]?key\s*=|Bearer\s+/i;

function parseArgs(argv) {
  const options = {
    format: 'json',
    runId: undefined,
    status: undefined,
    from: undefined,
    to: undefined,
    syntheticOnly: false,
    limit: 500,
  };

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg.startsWith('--format=')) {
      options.format = arg.slice('--format='.length);
      continue;
    }
    if (arg.startsWith('--run-id=')) {
      options.runId = arg.slice('--run-id='.length);
      continue;
    }
    if (arg.startsWith('--status=')) {
      options.status = arg.slice('--status='.length);
      continue;
    }
    if (arg.startsWith('--from=')) {
      options.from = arg.slice('--from='.length);
      continue;
    }
    if (arg.startsWith('--to=')) {
      options.to = arg.slice('--to='.length);
      continue;
    }
    if (arg === '--synthetic-only' || arg === '--synthetic-only=true') {
      options.syntheticOnly = true;
      continue;
    }
    if (arg.startsWith('--limit=')) {
      options.limit = Number.parseInt(arg.slice('--limit='.length), 10);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!['json', 'markdown'].includes(options.format)) {
    throw new Error(`Unsupported format: ${options.format}`);
  }
  if (!Number.isFinite(options.limit) || options.limit <= 0 || options.limit > 5000) {
    throw new Error('--limit must be between 1 and 5000');
  }

  return options;
}

function printHelp() {
  process.stdout.write(
    [
      'V10 Shadow Replay G10 manual results reporter (read-only).',
      '',
      'Environment:',
      `  ${CONNECTION_ENV}  PostgreSQL URL (required for live reads; never printed)`,
      '',
      'Options:',
      '  --format=json|markdown   Output format (default: json)',
      '  --run-id=<id>            Filter by run_id',
      '  --status=<status>        Filter runs by status',
      '  --from=<iso>             created_at lower bound',
      '  --to=<iso>               created_at upper bound',
      '  --synthetic-only         Only synthetic/shadow-* records',
      '  --limit=<n>              Row limit per table (default 500, max 5000)',
      '',
    ].join('\n'),
  );
}

function assertOutputSafe(text) {
  if (SECRET_IN_OUTPUT_RE.test(text)) {
    throw new Error('Reporter output would expose credentials or connection details.');
  }
  if (PII_VALUE_RE.test(text)) {
    throw new Error('Reporter output would expose PII-like values.');
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const databaseUrl = process.env[CONNECTION_ENV];
  if (!databaseUrl || databaseUrl.trim().length === 0) {
    throw new Error(
      `${CONNECTION_ENV} is required. This script does not load .env automatically.`,
    );
  }

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const reader = new ShadowReplayPostgresReader(pool);

  try {
    const filter = {
      run_id: options.runId,
      status: options.status,
      from: options.from,
      to: options.to,
      synthetic_only: options.syntheticOnly,
      limit: options.limit,
    };

    const report = maskShadowReplayResultsReportForOutput(
      await generateShadowReplayResultsReportFromStore(reader, filter),
    );

    const output =
      options.format === 'markdown'
        ? serializeShadowReplayResultsReportMarkdown(report)
        : serializeShadowReplayResultsReportJson(report);

    assertOutputSafe(output);
    process.stdout.write(output);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`G10 reporter error: ${message.replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted-url]')}\n`);
  process.exitCode = 1;
});
