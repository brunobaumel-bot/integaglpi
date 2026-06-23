/**
 * V10 Shadow Replay Lab G6 - pure envelope validation.
 *
 * Validation returns structured issue codes and paths only. It never echoes
 * suspicious values back to callers or logs.
 */

import {
  SHADOW_REPLAY_SAMPLE_ENVELOPE_SCHEMA_VERSION,
  type ShadowReplaySampleEnvelope,
  type ShadowReplaySampleValidationIssue,
  type ShadowReplaySampleValidationResult,
} from './ShadowReplaySampleEnvelope.js';
import type { ShadowReplaySanitizedValue } from './ShadowReplayStoreTypes.js';
import {
  SHADOW_REPLAY_SAMPLE_RESIDUAL_PII_RE,
  SHADOW_REPLAY_SAMPLE_SANITIZER_FORBIDDEN_KEY_RE,
} from './ShadowReplaySampleSanitizer.js';

const HASH_RE = /^[a-f0-9]{64}$/;
const VALID_ID_RE = /^shadow-[a-z0-9-]{3,80}$/;
const VALID_SOURCE_KINDS = new Set(['synthetic_ticket', 'synthetic_conversation', 'synthetic_message', 'synthetic_case']);

function issue(code: ShadowReplaySampleValidationIssue['code'], path: string, message: string): ShadowReplaySampleValidationIssue {
  return { code, path, message };
}

function scanSanitizedValue(value: ShadowReplaySanitizedValue, path: string, issues: ShadowReplaySampleValidationIssue[]): void {
  if (typeof value === 'string') {
    if (SHADOW_REPLAY_SAMPLE_RESIDUAL_PII_RE.test(value)) {
      issues.push(issue('residual_pii', path, 'Sanitized value still matches a sensitive-data pattern.'));
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanSanitizedValue(item, `${path}[${index}]`, issues));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      const childPath = `${path}.${key}`;
      if (SHADOW_REPLAY_SAMPLE_SANITIZER_FORBIDDEN_KEY_RE.test(key)) {
        issues.push(issue('forbidden_key', childPath, 'Envelope contains a forbidden raw-data key.'));
        continue;
      }
      scanSanitizedValue(child, childPath, issues);
    }
  }
}

export function validateShadowReplaySampleEnvelope(envelope: ShadowReplaySampleEnvelope): ShadowReplaySampleValidationResult {
  const issues: ShadowReplaySampleValidationIssue[] = [];

  if (envelope.schema_version !== SHADOW_REPLAY_SAMPLE_ENVELOPE_SCHEMA_VERSION) {
    issues.push(issue('schema_version_mismatch', 'schema_version', 'Envelope schema version is not supported.'));
  }
  if (!VALID_ID_RE.test(envelope.run_id)) {
    issues.push(issue('invalid_reference', 'run_id', 'Run id must be synthetic and namespaced.'));
  }
  if (!VALID_ID_RE.test(envelope.sample_id)) {
    issues.push(issue('invalid_reference', 'sample_id', 'Sample id must be synthetic and namespaced.'));
  }
  if (!VALID_SOURCE_KINDS.has(envelope.source_kind)) {
    issues.push(issue('invalid_source_kind', 'source_kind', 'Source kind must be synthetic.'));
  }
  if (!HASH_RE.test(envelope.source_ref_hash)) {
    issues.push(issue('invalid_reference', 'source_ref_hash', 'Source reference must be a 64-char hash.'));
  }
  if (envelope.sanitized_problem_summary.trim() === '') {
    issues.push(issue('empty_summary', 'sanitized_problem_summary', 'Problem summary is required after sanitization.'));
  }

  if (SHADOW_REPLAY_SAMPLE_RESIDUAL_PII_RE.test(envelope.sanitized_problem_summary)) {
    issues.push(issue('residual_pii', 'sanitized_problem_summary', 'Problem summary still matches a sensitive-data pattern.'));
  }
  if (SHADOW_REPLAY_SAMPLE_RESIDUAL_PII_RE.test(envelope.sanitized_technical_summary)) {
    issues.push(issue('residual_pii', 'sanitized_technical_summary', 'Technical summary still matches a sensitive-data pattern.'));
  }

  scanSanitizedValue(envelope.classification_metadata, 'classification_metadata', issues);
  scanSanitizedValue(envelope.sanitized_metadata, 'sanitized_metadata', issues);
  for (const [index, path] of envelope.redaction_report.forbidden_keys.entries()) {
    if (SHADOW_REPLAY_SAMPLE_RESIDUAL_PII_RE.test(path)) {
      issues.push(issue('residual_pii', `redaction_report.forbidden_keys[${index}]`, 'Redaction report path is not sanitized.'));
    }
  }

  return {
    ok: issues.length === 0,
    issues,
  };
}
