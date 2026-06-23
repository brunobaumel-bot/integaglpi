import { describe, expect, it } from 'vitest';

import { runShadowReplayDryRun } from '../src/shadowReplay/ShadowReplayDryRunEngine.js';
import type { ShadowReplaySampleEnvelope } from '../src/shadowReplay/ShadowReplaySampleEnvelope.js';
import { createShadowReplaySampleEnvelope } from '../src/shadowReplay/ShadowReplaySampleSanitizer.js';

const EMAIL = ['ana.sintetica', 'example.test'].join('@');
const PHONE = ['+55 (41) ', '98888', '-7777'].join('');
const SENSITIVE_MARKER = 'Bearer abcdefghijklmnopqrstuvwxyz123456';
const SYNTHETIC_TICKET = '9999000001';

function cleanEnvelope(overrides: Partial<ShadowReplaySampleEnvelope> = {}): ShadowReplaySampleEnvelope {
  return {
    ...createShadowReplaySampleEnvelope({
      run_id: 'shadow-run-g8-synthetic',
      sample_id: 'shadow-sample-g8-synthetic',
      source_kind: 'synthetic_case',
      source_ref: 'shadow-source-g8-dry-run',
      problem_summary: [
        `Contato sintetico ${EMAIL} telefone ${PHONE}.`,
        `ticket ${SYNTHETIC_TICKET} e ${SENSITIVE_MARKER} devem ser removidos.`,
        'Usuario sintetico relata VPN conectando sem acesso ao sistema.',
      ].join(' '),
      technical_summary: 'Resumo tecnico sintetico sem dado real.',
      classification: { category: 'vpn', confidence: 0.87 },
      metadata: { phase: 'g8', synthetic: true, source: 'unit_test' },
      observed_at: '2026-06-23T00:00:00.000Z',
      created_at: '2026-06-23T00:00:00.000Z',
    }),
    ...overrides,
  };
}

describe('V10 Shadow Replay G8 dry-run replay engine contract', () => {
  it('accepts a clean G6 sanitized envelope and returns in-memory dry-run PASS', () => {
    const result = runShadowReplayDryRun({ envelope: cleanEnvelope() });
    const serialized = JSON.stringify(result);

    expect(result.status).toBe('passed');
    expect(result.decision).toBe('accepted_dry_run');
    expect(result.contract_version).toBe('g8_dry_run_engine_v1');
    expect(result.result_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.would_persist).toBe(false);
    expect(result.external_actions_allowed).toBe(false);
    expect(result.ai_called).toBe(false);
    expect(result.runtime_worker_created).toBe(false);
    expect(result.operations_checked).toHaveLength(6);
    expect(result.operations_blocked.map((item) => item.kind)).toEqual(
      expect.arrayContaining(['shadow_store_write', 'ai_call', 'external_action', 'runtime_worker']),
    );
    expect(serialized).not.toContain(EMAIL);
    expect(serialized).not.toContain(PHONE);
    expect(serialized).not.toContain(SENSITIVE_MARKER);
    expect(serialized).not.toContain(SYNTHETIC_TICKET);
  });

  it('rejects an envelope contaminated with residual PII', () => {
    const contaminated = cleanEnvelope({
      sanitized_problem_summary: `residual ${EMAIL}`,
    });

    const result = runShadowReplayDryRun({ envelope: contaminated });
    expect(result.status).toBe('blocked');
    expect(result.decision).toBe('rejected_invalid_envelope');
    expect(result.violations.map((item) => item.code)).toContain('invalid_envelope');
    expect(result.envelope_validation_issues.map((item) => item.code)).toContain('residual_pii');
    expect(JSON.stringify(result)).not.toContain(EMAIL);
  });

  it('rejects raw payload, transcript and messages metadata keys', () => {
    for (const key of ['raw_payload', 'transcript', 'messages'] as const) {
      const rawValue = `unsafe-${key}-value`;
      const contaminated = cleanEnvelope({
        sanitized_metadata: {
          [key]: rawValue,
        },
      });
      const result = runShadowReplayDryRun({ envelope: contaminated });
      expect(result.status).toBe('blocked');
      expect(result.envelope_validation_issues.map((item) => item.code)).toContain('forbidden_key');
      expect(JSON.stringify(result)).not.toContain(rawValue);
    }
  });

  it('requires source_ref_hash to already be a hash', () => {
    const result = runShadowReplayDryRun({
      envelope: cleanEnvelope({ source_ref_hash: 'not-a-hash' }),
    });

    expect(result.status).toBe('blocked');
    expect(result.envelope_validation_issues.map((item) => item.path)).toContain('source_ref_hash');
  });

  it('keeps every external or persistence operation blocked or skipped', () => {
    const result = runShadowReplayDryRun({ envelope: cleanEnvelope() });

    for (const op of result.operations_checked) {
      expect(op.executed).toBe(false);
      expect(['simulated', 'blocked', 'skipped']).toContain(op.status);
    }
    expect(result.operations_checked.filter((op) => op.kind === 'shadow_store_write')[0]?.status).toBe('blocked');
    expect(result.operations_checked.filter((op) => op.kind === 'ai_call')[0]?.status).toBe('blocked');
    expect(result.operations_checked.filter((op) => op.kind === 'external_action')[0]?.status).toBe('blocked');
  });

  it('generates deterministic result_hash for the same synthetic input', () => {
    const envelope = cleanEnvelope();
    const first = runShadowReplayDryRun({ envelope });
    const second = runShadowReplayDryRun({ envelope });

    expect(first.result_hash).toBe(second.result_hash);
    expect(first.created_at).toBe(second.created_at);
  });

  it('does not expose raw payload labels, original values or real endpoints in the result', () => {
    const result = runShadowReplayDryRun({ envelope: cleanEnvelope() });
    const serialized = JSON.stringify(result);

    expect(serialized).not.toMatch(/raw_payload|payload_json|transcript|messages/i);
    expect(serialized).not.toMatch(/https?:\/\//i);
    expect(serialized).not.toMatch(/\+55/);
    expect(serialized).not.toContain('@');
    expect(serialized).not.toContain(SENSITIVE_MARKER);
  });

  it('never marks a write, AI call or external action as executed when envelope is invalid', () => {
    const result = runShadowReplayDryRun({
      envelope: cleanEnvelope({ source_ref_hash: 'not-a-hash' }),
    });

    expect(result.status).toBe('blocked');
    expect(result.would_persist).toBe(false);
    expect(result.external_actions_allowed).toBe(false);
    expect(result.ai_called).toBe(false);
    expect(result.operations_checked.every((op) => op.executed === false)).toBe(true);
  });
});
