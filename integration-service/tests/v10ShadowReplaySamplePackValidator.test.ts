import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  SHADOW_REPLAY_SAMPLE_PACK_VALIDATOR_VERSION,
  serializeSamplePackValidationJson,
  serializeSamplePackValidationMarkdown,
  validateShadowReplaySamplePack,
  type ShadowReplaySamplePackManifest,
} from '../src/shadowReplay/ShadowReplaySamplePackValidator.js';
import { createShadowReplaySampleEnvelope } from '../src/shadowReplay/ShadowReplaySampleSanitizer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PACK_DIR = join(ROOT, 'shadow-replay-samples', 'curated-v1');
const VALIDATOR_SOURCE = join(ROOT, 'src', 'shadowReplay', 'ShadowReplaySamplePackValidator.ts');
const CLI_SOURCE = join(ROOT, 'scripts', 'v10ShadowReplayValidateSamplePack.mjs');

const CURATED_MANIFEST: ShadowReplaySamplePackManifest = JSON.parse(
  readFileSync(join(PACK_DIR, 'expected-manifest.json'), 'utf8'),
);
const CURATED_JSONL = readFileSync(join(PACK_DIR, 'samples.sanitized.jsonl'), 'utf8');

function makeEnvelope(index: number, category = 'vpn') {
  return createShadowReplaySampleEnvelope({
    run_id: `shadow-run-g15-test-${String(index).padStart(3, '0')}`,
    sample_id: `shadow-sample-g15-test-${String(index).padStart(3, '0')}`,
    source_kind: 'synthetic_case',
    source_ref: `shadow-source-g15-test-${index}`,
    problem_summary: `Caso sintetico G15 ${index}: problema de ${category}.`,
    technical_summary: `Resumo tecnico G15 ${index}.`,
    classification: { category, confidence: 0.90 },
    metadata: { synthetic: true, phase: 'g15', fixture_index: index },
    observed_at: '2026-06-23T00:00:00.000Z',
    created_at: '2026-06-23T00:00:00.000Z',
  });
}

function jsonl(items: readonly unknown[]): string {
  return `${items.map((item) => JSON.stringify(item)).join('\n')}\n`;
}

function testManifest(overrides?: Partial<ShadowReplaySamplePackManifest>): ShadowReplaySamplePackManifest {
  return {
    schema_version: 'g15_curated_sample_pack_v1',
    pack_name: 'test',
    total_lines: 1,
    expected_valid: 1,
    expected_rejected: 0,
    rejection_codes: [],
    categories_covered: ['vpn'],
    ...overrides,
  };
}

describe('V10 Shadow Replay G15 sample pack validator', () => {
  it('validates the curated pack against its expected manifest', () => {
    const result = validateShadowReplaySamplePack(CURATED_JSONL, CURATED_MANIFEST);
    expect(result.validator_version).toBe(SHADOW_REPLAY_SAMPLE_PACK_VALIDATOR_VERSION);
    expect(result.manifest_match).toBe(true);
    expect(result.pii_detected).toBe(false);
    expect(result.valid).toBe(CURATED_MANIFEST.expected_valid);
    expect(result.rejected).toBe(CURATED_MANIFEST.expected_rejected);
    expect(result.total_lines).toBe(CURATED_MANIFEST.total_lines);
    expect(result.read_only).toBe(true);
    expect(result.db_accessed).toBe(false);
    expect(result.external_actions_allowed).toBe(false);
  });

  it('finds all expected categories in the curated pack', () => {
    const result = validateShadowReplaySamplePack(CURATED_JSONL, CURATED_MANIFEST);
    const found = new Set(result.categories_found);
    for (const cat of CURATED_MANIFEST.categories_covered) {
      expect(found.has(cat), `category ${cat} should be found`).toBe(true);
    }
  });

  it('curated pack has expected rejection codes', () => {
    const result = validateShadowReplaySamplePack(CURATED_JSONL, CURATED_MANIFEST);
    const codes = new Set(result.rejected_lines.map((rl) => rl.code));
    expect(codes.has('raw_key_forbidden')).toBe(true);
    expect(codes.has('source_ref_not_hash')).toBe(true);
  });

  it('accepts valid G6 envelopes', () => {
    const e = makeEnvelope(1);
    const result = validateShadowReplaySamplePack(jsonl([e]), testManifest());
    expect(result.valid).toBe(1);
    expect(result.rejected).toBe(0);
    expect(result.manifest_match).toBe(true);
    expect(result.pii_detected).toBe(false);
  });

  it('rejects lines with raw_payload key', () => {
    const contaminated = { ...makeEnvelope(1), raw_payload: { text: 'raw body' } };
    const manifest = testManifest({ expected_valid: 0, expected_rejected: 1, rejection_codes: ['raw_key_forbidden'], categories_covered: [] });
    const result = validateShadowReplaySamplePack(jsonl([contaminated]), manifest);
    expect(result.rejected).toBe(1);
    expect(result.rejected_lines[0]?.code).toBe('raw_key_forbidden');
    expect(result.manifest_match).toBe(true);
  });

  it('rejects lines with messages key', () => {
    const contaminated = { ...makeEnvelope(1), messages: [{ text: 'raw message' }] };
    const manifest = testManifest({ expected_valid: 0, expected_rejected: 1, rejection_codes: ['raw_key_forbidden'], categories_covered: [] });
    const result = validateShadowReplaySamplePack(jsonl([contaminated]), manifest);
    expect(result.rejected_lines[0]?.code).toBe('raw_key_forbidden');
  });

  it('rejects lines with transcript key', () => {
    const contaminated = { ...makeEnvelope(1), transcript: 'raw transcript' };
    const manifest = testManifest({ expected_valid: 0, expected_rejected: 1, rejection_codes: ['raw_key_forbidden'], categories_covered: [] });
    const result = validateShadowReplaySamplePack(jsonl([contaminated]), manifest);
    expect(result.rejected_lines[0]?.code).toBe('raw_key_forbidden');
  });

  it('rejects lines with source_ref non-hash value', () => {
    const contaminated = { ...makeEnvelope(1), source_ref: 'raw-ticket-or-message-ref' };
    const manifest = testManifest({ expected_valid: 0, expected_rejected: 1, rejection_codes: ['source_ref_not_hash'], categories_covered: [] });
    const result = validateShadowReplaySamplePack(jsonl([contaminated]), manifest);
    expect(result.rejected).toBe(1);
    expect(result.rejected_lines[0]?.code).toBe('source_ref_not_hash');
    expect(result.manifest_match).toBe(true);
  });

  it('detects residual PII in envelope summaries and does not echo it', () => {
    const contaminated = {
      ...makeEnvelope(1),
      sanitized_problem_summary: 'contato residual usuario@example.com presente no resumo',
    };
    const manifest = testManifest({ expected_valid: 0, expected_rejected: 1, rejection_codes: ['pii_detected'], categories_covered: [] });
    const result = validateShadowReplaySamplePack(jsonl([contaminated]), manifest);
    expect(result.pii_detected).toBe(true);
    expect(result.rejected).toBe(1);
    expect(result.rejected_lines[0]?.code).toBe('pii_detected');
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('usuario@example.com');
  });

  it('reports invalid JSON lines', () => {
    const manifest = testManifest({ expected_valid: 0, expected_rejected: 1, rejection_codes: ['invalid_json'], categories_covered: [] });
    const result = validateShadowReplaySamplePack('{not-valid-json}\n', manifest);
    expect(result.rejected).toBe(1);
    expect(result.rejected_lines[0]?.code).toBe('invalid_json');
    expect(result.manifest_match).toBe(true);
  });

  it('reports manifest mismatches when total_lines differs', () => {
    const manifest = testManifest({ total_lines: 5, categories_covered: ['vpn', 'printer'] });
    const result = validateShadowReplaySamplePack(jsonl([makeEnvelope(1)]), manifest);
    expect(result.manifest_match).toBe(false);
    expect(result.manifest_mismatches.some((m) => m.includes('total_lines'))).toBe(true);
  });

  it('reports manifest mismatches when a category is missing', () => {
    const manifest = testManifest({ categories_covered: ['vpn', 'printer'] });
    const result = validateShadowReplaySamplePack(jsonl([makeEnvelope(1, 'vpn')]), manifest);
    expect(result.manifest_match).toBe(false);
    expect(result.manifest_mismatches.some((m) => m.includes('printer'))).toBe(true);
  });

  it('reports manifest mismatches when rejection_code is missing', () => {
    const e = makeEnvelope(1);
    const contaminated = { ...e, raw_payload: {} };
    const manifest = testManifest({
      expected_valid: 0,
      expected_rejected: 1,
      rejection_codes: ['raw_key_forbidden', 'source_ref_not_hash'],
      categories_covered: [],
    });
    const result = validateShadowReplaySamplePack(jsonl([contaminated]), manifest);
    expect(result.manifest_match).toBe(false);
    expect(result.manifest_mismatches.some((m) => m.includes('source_ref_not_hash'))).toBe(true);
  });

  it('processes multiple valid envelopes across multiple categories', () => {
    const categories = ['vpn', 'printer', 'email_issue'];
    const envelopes = categories.map((cat, i) => makeEnvelope(i + 1, cat));
    const manifest = testManifest({
      total_lines: 3,
      expected_valid: 3,
      expected_rejected: 0,
      categories_covered: ['email_issue', 'printer', 'vpn'],
    });
    const result = validateShadowReplaySamplePack(jsonl(envelopes), manifest);
    expect(result.valid).toBe(3);
    expect(result.manifest_match).toBe(true);
    expect(result.categories_found).toEqual(['email_issue', 'printer', 'vpn']);
  });

  it('serializes valid JSON output without PII or secrets', () => {
    const result = validateShadowReplaySamplePack(CURATED_JSONL, CURATED_MANIFEST);
    const output = serializeSamplePackValidationJson(result);
    expect(output).toContain('"validator_version": "g15_sample_pack_validator_v1"');
    expect(output).toContain('"manifest_match": true');
    expect(output).toContain('"read_only": true');
    expect(output).toContain('"db_accessed": false');
    const parsed = JSON.parse(output);
    expect(parsed.external_actions_allowed).toBe(false);
  });

  it('serializes PASS Markdown output for curated pack', () => {
    const result = validateShadowReplaySamplePack(CURATED_JSONL, CURATED_MANIFEST);
    const md = serializeSamplePackValidationMarkdown(result);
    expect(md).toContain('# Shadow Replay G15 Sample Pack Validation');
    expect(md).toContain('status: PASS');
    expect(md).toContain('manifest_match: true');
    expect(md).toContain('pii_detected: false');
  });

  it('serializes FAIL Markdown output when manifest mismatches', () => {
    const manifest = testManifest({ total_lines: 99 });
    const result = validateShadowReplaySamplePack(jsonl([makeEnvelope(1)]), manifest);
    const md = serializeSamplePackValidationMarkdown(result);
    expect(md).toContain('status: FAIL');
    expect(md).toContain('Manifest Mismatches');
  });
});

describe('V10 Shadow Replay G15 source isolation', () => {
  it('validator source does not import DB, Redis, HTTP, GLPI, Meta or AI', () => {
    const source = readFileSync(VALIDATOR_SOURCE, 'utf8');
    expect(source).not.toMatch(/from\s+['"]pg['"]/);
    expect(source).not.toMatch(/from\s+['"]ioredis['"]/);
    expect(source).not.toMatch(/from\s+['"]redis['"]/);
    expect(source).not.toMatch(/from\s+['"]node:http['"]/);
    expect(source).not.toMatch(/from\s+['"]node:https['"]/);
    expect(source).not.toContain('MetaClient');
    expect(source).not.toContain('GlpiClient');
    expect(source).not.toContain('OutboundMessageService');
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/\bprocess\.env\b/);
    expect(source).not.toMatch(/\bapp\.ts\b/);
  });

  it('CLI source does not load dotenv, does not import operational clients, does not access DB', () => {
    const source = readFileSync(CLI_SOURCE, 'utf8');
    expect(source).not.toMatch(/\bdotenv\b/);
    expect(source).not.toContain('MetaClient');
    expect(source).not.toContain('GlpiClient');
    expect(source).not.toContain('OutboundMessageService');
    expect(source).not.toMatch(/from\s+['"]pg['"]/);
    expect(source).not.toMatch(/from\s+['"]ioredis['"]/);
    expect(source).not.toMatch(/from\s+['"]node:http['"]/);
    expect(source).not.toMatch(/from\s+['"]node:https['"]/);
    expect(source).not.toMatch(/\bprocess\.env\b/);
  });

  it('validator version constant is correct literal', () => {
    expect(SHADOW_REPLAY_SAMPLE_PACK_VALIDATOR_VERSION).toBe('g15_sample_pack_validator_v1');
  });
});
