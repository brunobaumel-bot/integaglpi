/**
 * V10 Shadow Replay Lab G11 - manual JSONL batch runner CLI.
 *
 * Manual/HML/dev only. Does not load .env and never prints the connection URL.
 * Runtime workers, GLPI, Meta/WhatsApp, Redis and AI are not imported here.
 *
 * Usage:
 *   npx tsc -p tsconfig.shadow-replay.json
 *   SHADOW_REPLAY_BATCH_DATABASE_URL='postgres://...' node scripts/v10ShadowReplayManualBatchRunner.mjs --input samples.jsonl --rollback --synthetic-only --report json
 */

import { readFile } from 'node:fs/promises';

import pg from 'pg';

import {
  runShadowReplayManualBatch,
  serializeShadowReplayManualBatchJson,
  serializeShadowReplayManualBatchMarkdown,
} from '../dist-shadow-replay/ShadowReplayManualBatchRunner.js';
import { ShadowReplayPostgresStore } from '../dist-shadow-replay/ShadowReplayPostgresStore.js';

const CONNECTION_ENV = 'SHADOW_REPLAY_BATCH_DATABASE_URL';
const SECRET_IN_OUTPUT_RE = /postgres(?:ql)?:\/\/|password\s*=|api[_-]?key\s*=|Bearer\s+/i;
const PII_VALUE_RE =
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\b(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?(?:9\s?)?\d{4}[-.\s]?\d{4}\b|\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/i;

function parseArgs(argv) {
  const options = {
    input: undefined,
    dryRun: false,
    rollback: false,
    syntheticOnly: false,
    failFast: false,
    report: 'json',
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--input') {
      options.input = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith('--input=')) {
      options.input = arg.slice('--input='.length);
      continue;
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (arg === '--rollback') {
      options.rollback = true;
      continue;
    }
    if (arg === '--synthetic-only') {
      options.syntheticOnly = true;
      continue;
    }
    if (arg === '--fail-fast') {
      options.failFast = true;
      continue;
    }
    if (arg === '--report') {
      options.report = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith('--report=')) {
      options.report = arg.slice('--report='.length);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.input) throw new Error('--input <file.jsonl> is required');
  if (!['json', 'markdown'].includes(options.report)) {
    throw new Error('--report must be json or markdown');
  }
  return options;
}

function printHelp() {
  process.stdout.write(
    [
      'V10 Shadow Replay G11 manual batch runner.',
      '',
      'Environment:',
      `  ${CONNECTION_ENV}  PostgreSQL URL (required; never printed)`,
      '',
      'Options:',
      '  --input <file.jsonl>  Local JSONL file with one sanitized G6 envelope per line',
      '  --dry-run             Use in-memory Shadow Store only',
      '  --rollback            Execute DB writes inside BEGIN/ROLLBACK',
      '  --synthetic-only      Require synthetic shadow-* envelopes',
      '  --fail-fast           Stop after first rejected line or blocked envelope',
      '  --report json|markdown',
      '',
    ].join('\n'),
  );
}

function assertOutputSafe(text) {
  if (SECRET_IN_OUTPUT_RE.test(text)) {
    throw new Error('Batch output would expose credentials or connection details.');
  }
  if (PII_VALUE_RE.test(text)) {
    throw new Error('Batch output would expose PII-like values.');
  }
}

function redactError(message) {
  return message.replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted-url]');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const databaseUrl = process.env[CONNECTION_ENV];
  if (!databaseUrl || databaseUrl.trim().length === 0) {
    throw new Error(`${CONNECTION_ENV} is required. This script does not load .env automatically.`);
  }

  const jsonl = await readFile(options.input, 'utf8');
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();

  try {
    if (!options.dryRun) {
      await client.query('BEGIN');
    }

    const store = new ShadowReplayPostgresStore(client);
    const result = await runShadowReplayManualBatch(jsonl, store, {
      dryRun: options.dryRun,
      rollback: options.rollback,
      syntheticOnly: options.syntheticOnly,
      failFast: options.failFast,
      reportFormat: options.report,
    });

    if (!options.dryRun) {
      await client.query(options.rollback ? 'ROLLBACK' : 'COMMIT');
    }

    const output = options.report === 'markdown'
      ? serializeShadowReplayManualBatchMarkdown(result)
      : serializeShadowReplayManualBatchJson(result);
    assertOutputSafe(output);
    process.stdout.write(output);
  } catch (error) {
    if (!options.dryRun) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // The original error is more useful; rollback failure must not expose details.
      }
    }
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`G11 batch runner error: ${redactError(message)}\n`);
  process.exitCode = 1;
});
