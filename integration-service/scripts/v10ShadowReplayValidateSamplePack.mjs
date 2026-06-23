/**
 * V10 Shadow Replay Lab G15 - sample pack validator CLI.
 *
 * Manual/dev only. Reads JSONL and manifest from disk and validates.
 * No .env loading, no DB, no network, no external services.
 *
 * Usage:
 *   npx tsc -p tsconfig.shadow-replay.json
 *   node scripts/v10ShadowReplayValidateSamplePack.mjs \
 *     --input shadow-replay-samples/curated-v1/samples.sanitized.jsonl \
 *     --expect shadow-replay-samples/curated-v1/expected-manifest.json \
 *     --format json
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  serializeSamplePackValidationJson,
  serializeSamplePackValidationMarkdown,
  validateShadowReplaySamplePack,
} from '../dist-shadow-replay/ShadowReplaySamplePackValidator.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const SECRET_IN_OUTPUT_RE = /postgres(?:ql)?:\/\/|password\s*=|api[_-]?key\s*=|Bearer\s+/i;
const PII_VALUE_RE =
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\b(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?(?:9\s?)?\d{4}[-.\s]?\d{4}\b|\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/i;

function parseArgs(argv) {
  const options = {
    input: undefined,
    expect: undefined,
    format: 'json',
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

  if (!options.input) throw new Error('--input <file.jsonl> is required');
  if (!options.expect) throw new Error('--expect <manifest.json> is required');
  if (!['json', 'markdown'].includes(options.format)) {
    throw new Error('--format must be json or markdown');
  }
  return options;
}

function printHelp() {
  process.stdout.write(
    [
      'V10 Shadow Replay G15 sample pack validator.',
      '',
      'Options:',
      '  --input <file.jsonl>     JSONL file with sanitized G6 envelopes',
      '  --expect <manifest.json> Expected manifest JSON',
      '  --format json|markdown   Output format (default: json)',
      '',
      'Exit code 0 = PASS (manifest_match && !pii_detected).',
      'Exit code 1 = FAIL or error.',
      '',
    ].join('\n'),
  );
}

function assertOutputSafe(text) {
  if (SECRET_IN_OUTPUT_RE.test(text)) {
    throw new Error('Validation output would expose credentials or connection details.');
  }
  if (PII_VALUE_RE.test(text)) {
    throw new Error('Validation output would expose PII-like values.');
  }
}

function resolveInput(input) {
  if (input.startsWith('/') || /^[A-Za-z]:/.test(input)) return input;
  return join(ROOT, input);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const jsonl = readFileSync(resolveInput(options.input), 'utf8');
  const manifest = JSON.parse(readFileSync(resolveInput(options.expect), 'utf8'));

  const result = validateShadowReplaySamplePack(jsonl, manifest);

  const output = options.format === 'markdown'
    ? serializeSamplePackValidationMarkdown(result)
    : serializeSamplePackValidationJson(result);

  assertOutputSafe(output);
  process.stdout.write(output);

  if (!result.manifest_match || result.pii_detected) {
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`G15 validator error: ${message}\n`);
  process.exitCode = 1;
}
