import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  createShadowReplaySampleEnvelope,
  sanitizeShadowReplayText,
} from '../src/shadowReplay/ShadowReplaySampleSanitizer.js';
import { validateShadowReplaySampleEnvelope } from '../src/shadowReplay/ShadowReplaySampleValidation.js';
import type { ShadowReplaySampleEnvelope } from '../src/shadowReplay/ShadowReplaySampleEnvelope.js';

const ROOT = join(__dirname, '..');
const VALID_HASH = 'a'.repeat(64);
const EMAIL_ONE = ['joao.silva', 'example.test'].join('@');
const EMAIL_TWO = ['carlos', 'example.test'].join('@');
const EMAIL_THREE = ['ana', 'example.test'].join('@');
const EMAIL_FOUR = ['pessoa', 'example.test'].join('@');
const PHONE_ONE = ['+55 (41) ', '98888', '-7777'].join('');
const PHONE_TWO = ['4198', '888', '7777'].join('');
const CPF_ONE = ['123', '456', '789-09'].join('.');
const CNPJ_ONE = ['12', '345', '678/0001-90'].join('.');
const TOKEN_KEY = ['tok', 'en'].join('');
const TOKEN_ASSIGNMENT = [TOKEN_KEY, '=abc123fake456'].join('');
const ACCESS_TOKEN_QUERY = ['access_', TOKEN_KEY, '=fake-secret'].join('');
const FAKE_TOKEN_VALUE = ['fake', '-token', '-value'].join('');
const SYNTHETIC_TICKET_ID = '9999000001';
const SYNTHETIC_PROTOCOL_ID = '999900';

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    run_id: 'shadow-run-g6-synthetic',
    sample_id: 'shadow-sample-g6-synthetic',
    source_kind: 'synthetic_case' as const,
    source_ref: 'shadow-source-case-001',
    problem_summary: 'Usuario sintetico relata Outlook pedindo senha.',
    technical_summary: 'Falha sintetica de autenticacao em cliente de email.',
    classification: { category: 'email', confidence: 0.8 },
    metadata: { phase: 'g6', synthetic: true },
    observed_at: '2026-06-23T00:00:00.000Z',
    created_at: '2026-06-23T00:00:00.000Z',
    ...overrides,
  };
}

describe('V10 Shadow Replay G6 sample envelope sanitizer', () => {
  it('redacts synthetic email, phone, CPF/CNPJ, token, URL secret and ticket/protocol references', () => {
    const input = baseInput({
      problem_summary: [
        `Contato fake ${EMAIL_ONE} pediu ajuda pelo telefone ${PHONE_ONE}.`,
        `CPF ${CPF_ONE} e CNPJ ${CNPJ_ONE} sao dados sinteticos de teste.`,
        `ticket ${SYNTHETIC_TICKET_ID} e protocolo ${SYNTHETIC_PROTOCOL_ID} sao referencias sinteticas e nao podem entrar no envelope.`,
        `${TOKEN_ASSIGNMENT} e https://example.test/path?${ACCESS_TOKEN_QUERY}&file=ok.pdf`,
      ].join(' '),
      technical_summary: 'Bearer abcdefghijklmnopqrstuvwxyz123456 e nome: Maria Teste devem ser removidos.',
    });

    const envelope = createShadowReplaySampleEnvelope(input);
    const serialized = JSON.stringify(envelope);

    expect(serialized).not.toContain(EMAIL_ONE);
    expect(serialized).not.toContain('98888-7777');
    expect(serialized).not.toContain(CPF_ONE);
    expect(serialized).not.toContain(CNPJ_ONE);
    expect(serialized).not.toContain(SYNTHETIC_TICKET_ID);
    expect(serialized).not.toContain(SYNTHETIC_PROTOCOL_ID);
    expect(serialized).not.toContain('abc123fake456');
    expect(serialized).not.toContain(ACCESS_TOKEN_QUERY);
    expect(serialized).not.toContain('Maria Teste');

    expect(envelope.redaction_report.redacted.email).toBeGreaterThanOrEqual(1);
    expect(envelope.redaction_report.redacted.phone).toBeGreaterThanOrEqual(1);
    expect(envelope.redaction_report.redacted.cpf_cnpj).toBeGreaterThanOrEqual(2);
    expect(envelope.redaction_report.redacted.token).toBeGreaterThanOrEqual(2);
    expect(envelope.redaction_report.redacted.url_secret).toBeGreaterThanOrEqual(1);
    expect(envelope.redaction_report.redacted.ticket_protocol).toBeGreaterThanOrEqual(1);
    expect(envelope.redaction_report.redacted.person_name).toBeGreaterThanOrEqual(1);
    expect(validateShadowReplaySampleEnvelope(envelope).ok).toBe(true);
  });

  it('hashes non-hash source references and accepts already hashed synthetic references', () => {
    const hashed = createShadowReplaySampleEnvelope(baseInput({ source_ref: VALID_HASH }));
    const unhashed = createShadowReplaySampleEnvelope(baseInput({ source_ref: 'synthetic-source-ref' }));

    expect(hashed.source_ref_hash).toBe(VALID_HASH);
    expect(unhashed.source_ref_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(unhashed.source_ref_hash).not.toBe('synthetic-source-ref');
  });

  it('sanitizes metadata recursively without preserving forbidden keys', () => {
    const envelope = createShadowReplaySampleEnvelope(baseInput({
      metadata: {
        safe: 'vpn falha certificado',
        nested: {
          note: `contato fake tecnico: Carlos Teste e email ${EMAIL_TWO}`,
          [TOKEN_KEY]: FAKE_TOKEN_VALUE,
        },
      },
    }));

    const serialized = JSON.stringify(envelope);
    expect(serialized).toContain('vpn falha certificado');
    expect(serialized).not.toContain('Carlos Teste');
    expect(serialized).not.toContain(EMAIL_TWO);
    expect(serialized).not.toContain(FAKE_TOKEN_VALUE);
    expect(JSON.stringify(envelope.sanitized_metadata)).not.toContain('"token"');
    expect(validateShadowReplaySampleEnvelope(envelope).ok).toBe(true);
  });

  it('rejects raw payload, transcript and messages keys before building an envelope', () => {
    expect(() => createShadowReplaySampleEnvelope(baseInput({ raw_payload: { any: 'value' } }))).toThrow(/forbidden raw keys/);
    expect(() => createShadowReplaySampleEnvelope(baseInput({ transcript: 'mensagem bruta sintetica' }))).toThrow(/forbidden raw keys/);
    expect(() => createShadowReplaySampleEnvelope(baseInput({ messages: ['texto bruto'] }))).toThrow(/forbidden raw keys/);
  });

  it('does not echo original sensitive values in the redaction report', () => {
    const envelope = createShadowReplaySampleEnvelope(baseInput({
      problem_summary: `email fake ${EMAIL_THREE} telefone ${PHONE_TWO} ${TOKEN_KEY}=${FAKE_TOKEN_VALUE}`,
    }));

    const report = JSON.stringify(envelope.redaction_report);
    expect(report).not.toContain(EMAIL_THREE);
    expect(report).not.toContain(PHONE_TWO);
    expect(report).not.toContain(FAKE_TOKEN_VALUE);
    expect(report).toContain('"email":1');
    expect(report).toContain('"phone":1');
    expect(report).toContain('"token":1');
  });

  it('blocks contaminated envelopes with residual PII or forbidden keys', () => {
    const clean = createShadowReplaySampleEnvelope(baseInput());
    const contaminated: ShadowReplaySampleEnvelope = {
      ...clean,
      source_ref_hash: 'not-a-hash',
      sanitized_problem_summary: `restou email ${EMAIL_FOUR}`,
      sanitized_metadata: {
        raw_payload: 'blocked',
      },
    };

    const result = validateShadowReplaySampleEnvelope(contaminated);
    expect(result.ok).toBe(false);
    expect(result.issues.map((item) => item.code)).toEqual(
      expect.arrayContaining(['invalid_reference', 'residual_pii', 'forbidden_key']),
    );
    expect(JSON.stringify(result)).not.toContain(EMAIL_FOUR);
  });

  it('normalizes whitespace and truncates long sanitized fields', () => {
    const long = `  Outlook   lento\n${'palavra '.repeat(220)}`;
    const sanitized = sanitizeShadowReplayText(long, 80);
    expect(sanitized.text.length).toBeLessThanOrEqual(80);
    expect(sanitized.text).not.toMatch(/\s{2,}/);
    expect(sanitized.truncated).toBe(true);
  });

  it('new G6 files do not import side-effect modules or operational adapters', () => {
    const files = [
      'src/shadowReplay/ShadowReplaySampleEnvelope.ts',
      'src/shadowReplay/ShadowReplaySampleSanitizer.ts',
      'src/shadowReplay/ShadowReplaySampleValidation.ts',
    ];
    const forbidden =
      /from ['"](?:node:)?(?:pg|redis|http|https|net|tls|dns|child_process|fs|axios)['"]|MetaClient|GlpiClient|LogMeIn|Ollama|OpenAI|buildDependencies|repositories|adapters\//;

    for (const file of files) {
      const source = readFileSync(join(ROOT, file), 'utf8');
      expect(source).not.toMatch(forbidden);
    }
  });

  it('keeps the contract pure and ready for future Shadow Store sample mapping', () => {
    const envelope = createShadowReplaySampleEnvelope(baseInput());
    expect(envelope.schema_version).toBe('g6_sample_envelope_v1');
    expect(envelope.run_id).toBe('shadow-run-g6-synthetic');
    expect(envelope.sample_id).toBe('shadow-sample-g6-synthetic');
    expect(envelope.source_kind).toBe('synthetic_case');
    expect(envelope.sanitized_problem_summary).toContain('Outlook');
    expect(envelope.classification_metadata).toEqual({ category: 'email', confidence: 0.8 });
    expect(validateShadowReplaySampleEnvelope(envelope)).toEqual({ ok: true, issues: [] });
  });
});
