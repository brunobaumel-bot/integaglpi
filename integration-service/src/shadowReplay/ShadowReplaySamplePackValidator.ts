/**
 * V10 Shadow Replay Lab G15 - curated sample pack validator.
 *
 * Pure functions only. No I/O, no DB, no HTTP, no external services.
 * Validates a JSONL file of sanitized G6 envelopes against an expected manifest.
 */

import { SHADOW_REPLAY_SAMPLE_ENVELOPE_SCHEMA_VERSION } from './ShadowReplaySampleEnvelope.js';
import type { ShadowReplaySampleEnvelope } from './ShadowReplaySampleEnvelope.js';
import { SHADOW_REPLAY_SAMPLE_RESIDUAL_PII_RE } from './ShadowReplaySampleSanitizer.js';
import { validateShadowReplaySampleEnvelope } from './ShadowReplaySampleValidation.js';

export const SHADOW_REPLAY_SAMPLE_PACK_VALIDATOR_VERSION = 'g15_sample_pack_validator_v1' as const;

const HASH_RE = /^[a-f0-9]{64}$/;
const FORBIDDEN_RAW_KEY_RE = /^(raw_payload|messages?|transcript)$/i;

export type SamplePackRejectionCode =
  | 'invalid_json'
  | 'raw_key_forbidden'
  | 'source_ref_not_hash'
  | 'invalid_envelope'
  | 'pii_detected';

export interface SamplePackRejectedLine {
  readonly line_no: number;
  readonly code: SamplePackRejectionCode;
  readonly reason: string;
}

export interface ShadowReplaySamplePackManifest {
  readonly schema_version: string;
  readonly pack_name: string;
  readonly total_lines: number;
  readonly expected_valid: number;
  readonly expected_rejected: number;
  readonly rejection_codes: readonly string[];
  readonly categories_covered: readonly string[];
}

export interface ShadowReplaySamplePackValidationResult {
  readonly validator_version: typeof SHADOW_REPLAY_SAMPLE_PACK_VALIDATOR_VERSION;
  readonly total_lines: number;
  readonly valid: number;
  readonly rejected: number;
  readonly categories_found: readonly string[];
  readonly rejected_lines: readonly SamplePackRejectedLine[];
  readonly pii_detected: boolean;
  readonly manifest_match: boolean;
  readonly manifest_mismatches: readonly string[];
  readonly read_only: true;
  readonly db_accessed: false;
  readonly external_actions_allowed: false;
}

function collectForbiddenRawKeys(
  value: unknown,
  path = '$',
  found: { path: string; code: SamplePackRejectionCode; reason: string }[] = [],
): { path: string; code: SamplePackRejectionCode; reason: string }[] {
  if (!value || typeof value !== 'object') return found;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${path}.${key}`;
    if (FORBIDDEN_RAW_KEY_RE.test(key)) {
      found.push({ path: childPath, code: 'raw_key_forbidden', reason: `Forbidden raw key at ${childPath}.` });
      continue;
    }
    if (key === 'source_ref' && (typeof child !== 'string' || !HASH_RE.test(child))) {
      found.push({ path: childPath, code: 'source_ref_not_hash', reason: `source_ref must be a hash at ${childPath}.` });
      continue;
    }
    collectForbiddenRawKeys(child, childPath, found);
  }
  return found;
}

function extractCategory(envelope: ShadowReplaySampleEnvelope): string | null {
  const cat = (envelope.classification_metadata as Record<string, unknown>)?.['category'];
  return typeof cat === 'string' && cat.length > 0 ? cat : null;
}

function compareManifest(
  counts: { total_lines: number; valid: number; rejected: number; categories_found: readonly string[]; rejected_codes: readonly string[] },
  manifest: ShadowReplaySamplePackManifest,
): string[] {
  const mismatches: string[] = [];
  if (counts.total_lines !== manifest.total_lines) {
    mismatches.push(`total_lines: expected ${manifest.total_lines}, got ${counts.total_lines}`);
  }
  if (counts.valid !== manifest.expected_valid) {
    mismatches.push(`expected_valid: expected ${manifest.expected_valid}, got ${counts.valid}`);
  }
  if (counts.rejected !== manifest.expected_rejected) {
    mismatches.push(`expected_rejected: expected ${manifest.expected_rejected}, got ${counts.rejected}`);
  }
  for (const code of manifest.rejection_codes) {
    if (!counts.rejected_codes.includes(code)) {
      mismatches.push(`rejection_code missing: ${code}`);
    }
  }
  for (const cat of manifest.categories_covered) {
    if (!counts.categories_found.includes(cat)) {
      mismatches.push(`category missing: ${cat}`);
    }
  }
  return mismatches;
}

export function validateShadowReplaySamplePack(
  jsonl: string,
  manifest: ShadowReplaySamplePackManifest,
): ShadowReplaySamplePackValidationResult {
  const lines = jsonl.split(/\r?\n/).filter((line) => line.trim() !== '');
  const rejectedLines: SamplePackRejectedLine[] = [];
  const categoriesFound = new Set<string>();
  const rejectedCodes: string[] = [];
  let valid = 0;
  let piiDetected = false;

  for (const [index, line] of lines.entries()) {
    const lineNo = index + 1;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      rejectedLines.push({ line_no: lineNo, code: 'invalid_json', reason: 'Invalid JSON on this line.' });
      if (!rejectedCodes.includes('invalid_json')) rejectedCodes.push('invalid_json');
      continue;
    }

    const rawIssues = collectForbiddenRawKeys(parsed);
    if (rawIssues.length > 0) {
      const first = rawIssues[0]!;
      rejectedLines.push({ line_no: lineNo, code: first.code, reason: first.reason });
      if (!rejectedCodes.includes(first.code)) rejectedCodes.push(first.code);
      continue;
    }

    const envelope = parsed as ShadowReplaySampleEnvelope;
    const validation = validateShadowReplaySampleEnvelope(envelope);

    if (!validation.ok) {
      const criticalIssue = validation.issues.find(
        (issue) => issue.code === 'schema_version_mismatch' || issue.code === 'invalid_reference',
      );
      if (criticalIssue) {
        rejectedLines.push({ line_no: lineNo, code: 'invalid_envelope', reason: criticalIssue.code });
        if (!rejectedCodes.includes('invalid_envelope')) rejectedCodes.push('invalid_envelope');
        continue;
      }
      if (validation.issues.some((issue) => issue.code === 'residual_pii')) {
        piiDetected = true;
        rejectedLines.push({ line_no: lineNo, code: 'pii_detected', reason: 'Residual PII detected in envelope.' });
        if (!rejectedCodes.includes('pii_detected')) rejectedCodes.push('pii_detected');
        continue;
      }
    }

    if (SHADOW_REPLAY_SAMPLE_RESIDUAL_PII_RE.test(JSON.stringify(envelope))) {
      piiDetected = true;
    }

    const category = extractCategory(envelope);
    if (category) categoriesFound.add(category);
    valid += 1;
  }

  const categoriesFoundArr = [...categoriesFound].sort();
  const rejected = rejectedLines.length;

  const manifestMismatches = compareManifest(
    { total_lines: lines.length, valid, rejected, categories_found: categoriesFoundArr, rejected_codes: rejectedCodes },
    manifest,
  );

  return {
    validator_version: SHADOW_REPLAY_SAMPLE_PACK_VALIDATOR_VERSION,
    total_lines: lines.length,
    valid,
    rejected,
    categories_found: categoriesFoundArr,
    rejected_lines: rejectedLines,
    pii_detected: piiDetected,
    manifest_match: manifestMismatches.length === 0,
    manifest_mismatches: manifestMismatches,
    read_only: true,
    db_accessed: false,
    external_actions_allowed: false,
  };
}

export function serializeSamplePackValidationJson(result: ShadowReplaySamplePackValidationResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export function serializeSamplePackValidationMarkdown(result: ShadowReplaySamplePackValidationResult): string {
  const status = result.manifest_match && !result.pii_detected ? 'PASS' : 'FAIL';
  const lines = [
    '# Shadow Replay G15 Sample Pack Validation',
    '',
    `- status: ${status}`,
    `- validator_version: ${result.validator_version}`,
    `- total_lines: ${result.total_lines}`,
    `- valid: ${result.valid}`,
    `- rejected: ${result.rejected}`,
    `- pii_detected: ${result.pii_detected}`,
    `- manifest_match: ${result.manifest_match}`,
    '',
    '## Categories Found',
    ...result.categories_found.map((cat) => `- ${cat}`),
  ];
  if (result.rejected_lines.length > 0) {
    lines.push('', '## Rejected Lines');
    for (const rl of result.rejected_lines) {
      lines.push(`- line ${rl.line_no}: [${rl.code}] ${rl.reason}`);
    }
  }
  if (result.manifest_mismatches.length > 0) {
    lines.push('', '## Manifest Mismatches');
    for (const mm of result.manifest_mismatches) {
      lines.push(`- ${mm}`);
    }
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}
