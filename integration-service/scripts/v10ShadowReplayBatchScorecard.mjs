/**
 * V10 Shadow Replay Lab G13 - manual batch scorecard CLI.
 *
 * Reads local JSON files only. No .env, no DB, no runtime and no external calls.
 */

import { readFile } from 'node:fs/promises';

import {
  buildShadowReplayBatchScorecard,
  serializeShadowReplayBatchScorecardJson,
  serializeShadowReplayBatchScorecardMarkdown,
} from '../dist-shadow-replay/ShadowReplayBatchScorecard.js';

const SECRET_IN_OUTPUT_RE = /postgres(?:ql)?:\/\/|password\s*=|api[_-]?key\s*=|Bearer\s+/i;
const PII_VALUE_RE =
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\b(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?(?:9\s?)?\d{4}[-.\s]?\d{4}\b|\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/i;

function parseArgs(argv) {
  const options = { report: undefined, expect: undefined, format: 'json', help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
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
    if (arg === '--expect') {
      options.expect = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith('--expect=')) {
      options.expect = arg.slice('--expect='.length);
      continue;
    }
    if (arg === '--format') {
      options.format = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith('--format=')) {
      options.format = arg.slice('--format='.length);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.help && !options.report) throw new Error('--report <batch-report.json> is required');
  if (!options.help && !options.expect) throw new Error('--expect <expected-manifest.json> is required');
  if (!['json', 'markdown'].includes(options.format)) throw new Error('--format must be json or markdown');
  return options;
}

function printHelp() {
  process.stdout.write(
    [
      'V10 Shadow Replay G13 manual batch scorecard.',
      '',
      'Options:',
      '  --report <batch-report.json>       G11 JSON output',
      '  --expect <expected-manifest.json>  Local synthetic expectations',
      '  --format json|markdown             Output format',
      '',
    ].join('\n'),
  );
}

function assertOutputSafe(text) {
  if (SECRET_IN_OUTPUT_RE.test(text)) {
    throw new Error('Scorecard output would expose credentials.');
  }
  if (PII_VALUE_RE.test(text)) {
    throw new Error('Scorecard output would expose PII-like values.');
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const [report, expected] = await Promise.all([
    readJson(options.report),
    readJson(options.expect),
  ]);
  const scorecard = buildShadowReplayBatchScorecard(report, expected);
  const output = options.format === 'markdown'
    ? serializeShadowReplayBatchScorecardMarkdown(scorecard)
    : serializeShadowReplayBatchScorecardJson(scorecard);
  assertOutputSafe(output);
  process.stdout.write(output);
  if (scorecard.verdict === 'FAIL') {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`G13 scorecard error: ${message.replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted-url]')}\n`);
  process.exitCode = 1;
});
