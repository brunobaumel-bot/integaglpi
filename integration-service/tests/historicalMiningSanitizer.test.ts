import { describe, expect, it } from 'vitest';

import {
  hasObviousSensitiveContent,
  hashTicketIdentifier,
  sanitizeHistoricalText,
} from '../src/historicalMining/sanitizer.js';

describe('historical mining sanitizer', () => {
  it('removes obvious PII, secrets and binary-like payloads', () => {
    const sanitized = sanitizeHistoricalText(
      'Cliente Maria Silva email maria@example.com telefone +55 11 99999-8888 CPF 123.456.789-10 '
      + 'CNPJ 12.345.678/0001-90 IP 10.1.2.3 dominio srv01.corp token=abc123 senha=xyz '
      + 'Bearer abc.def.ghi contrato ABC-123 '
      + 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVoQUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVoQUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=',
    );

    expect(sanitized).toContain('[EMAIL]');
    expect(sanitized).toContain('[TELEFONE]');
    expect(sanitized).toContain('[DOCUMENTO]');
    expect(sanitized).toContain('[IP]');
    expect(sanitized).toContain('[DOMINIO_INTERNO]');
    expect(sanitized).toContain('[SEGREDO_REMOVIDO]');
    expect(sanitized).toContain('[BASE64_REMOVIDO]');
    expect(sanitized).not.toContain('maria@example.com');
    expect(sanitized).not.toContain('123.456.789-10');
    expect(sanitized).not.toContain('Bearer abc');
    expect(hasObviousSensitiveContent(sanitized)).toBe(false);
  });

  it('hashes real ticket ids and preserves already hashed ids', () => {
    const existing = 'a'.repeat(64);
    expect(hashTicketIdentifier(existing)).toBe(existing);
    expect(hashTicketIdentifier('2112319297')).toMatch(/^[a-f0-9]{64}$/);
    expect(hashTicketIdentifier('2112319297')).not.toBe('2112319297');
  });
});
