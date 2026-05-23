import { describe, expect, it } from 'vitest';

import { anonymizeAiPilotPayload } from '../src/privacy/anonymizeForAiPilot.js';

describe('AI pilot local anonymization', () => {
  it('masks PII and blocks sensitive payloads before cloud usage', () => {
    const result = anonymizeAiPilotPayload(
      'Cliente Bruno email bruno@example.com telefone 11999998888 CPF 123.456.789-09 IP 192.168.1.10 token=abc123456789 secret=hidden',
    );

    expect(result.text).toContain('[email]');
    expect(result.text).toContain('[telefone]');
    expect(result.text).toContain('[documento]');
    expect(result.text).toContain('[ip_privado]');
    expect(result.text).toContain('token=[redacted]');
    expect(result.detectedKinds).toContain('email');
    expect(result.detectedKinds).toContain('phone');
    expect(result.detectedKinds).toContain('cpf_cnpj');
    expect(result.text).toContain('Cliente: [nome]');
    expect(result.detectedKinds).toContain('secret');
    expect(result.blocked).toBe(true);
  });

  it('removes scripts, token URLs and base64-like blobs', () => {
    const result = anonymizeAiPilotPayload(
      '<script>alert(1)</script> https://example.test/path?access_token=secret ' + 'A'.repeat(100),
    );

    expect(result.text).not.toContain('<script>');
    expect(result.text).toContain('[token_url]');
    expect(result.text).toContain('[base64]');
    expect(result.blocked).toBe(true);
  });

  it('allows synthetic non-sensitive payloads with hashes only', () => {
    const result = anonymizeAiPilotPayload('Teste sintetico sem dados reais para medir latencia e custo.');

    expect(result.blocked).toBe(false);
    expect(result.originalHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.anonymizedPayloadHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
