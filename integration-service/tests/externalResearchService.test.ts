import { describe, expect, it } from 'vitest';

import { buildExternalResearchCandidate } from '../src/externalResearch/candidateBuilder.js';
import { sanitizeExternalResearchPrompt } from '../src/externalResearch/sanitizer.js';
import type { ExternalSourceCatalogEntry } from '../src/externalResearch/types.js';

const catalog: ExternalSourceCatalogEntry[] = [
  {
    id: 10,
    sourceKey: 'microsoft_learn',
    name: 'Microsoft Learn',
    urlPattern: '*.microsoft.com',
    sourceType: 'official_docs',
    officialFlag: true,
    priority: 10,
    confidenceBoost: 20,
    enabled: true,
    requiresVerification: true,
    language: 'pt-BR',
  },
];

const lowConfidenceCatalog: ExternalSourceCatalogEntry[] = [
  {
    id: 20,
    sourceKey: 'vendor_forum_reviewed',
    name: 'Vendor Forum Reviewed',
    urlPattern: '*.example.net',
    sourceType: 'low_confidence',
    officialFlag: false,
    priority: 80,
    confidenceBoost: 0,
    enabled: true,
    requiresVerification: true,
    language: 'pt-BR',
  },
];

describe('external research controlled flow', () => {
  it('anonymizes and blocks PII/secrets before external research', () => {
    const sanitized = sanitizeExternalResearchPrompt('Cliente: Bruno bruno@example.com telefone 11999999999 token=abc123456 Office nao ativa');

    expect(sanitized.sanitizedText).not.toContain('bruno@example.com');
    expect(sanitized.sanitizedText).not.toContain('11999999999');
    expect(sanitized.sanitizedText).not.toContain('abc123456');
    expect(sanitized.detectedKinds).toEqual(expect.arrayContaining(['email', 'phone', 'secret']));
    expect(sanitized.blocked).toBe(true);
  });

  it('generates a formal candidate only for cited official sources with confidence >= 70', () => {
    const sanitized = sanitizeExternalResearchPrompt('Office nao ativa apos troca de licença. Validar procedimento oficial.');
    const candidate = buildExternalResearchCandidate(sanitized, [
      { url: 'https://learn.microsoft.com/pt-br/microsoft-365/troubleshoot/activation/office-activation', title: 'Ativação Office' },
    ], catalog);

    expect(candidate.status).toBe('suggested');
    expect(candidate.confidenceScore).toBeGreaterThanOrEqual(70);
    expect(candidate.externalSources[0]?.officialFlag).toBe(true);
    expect(candidate.autoPublish).toBe(false);
    expect(candidate.humanReviewRequired).toBe(true);
    expect(candidate.suggestedKbArticle.contentMarkdown).toContain('Não execute comandos/scripts sem validação técnica humana.');
  });

  it('rejects a non allowlisted source before candidate creation', () => {
    const sanitized = sanitizeExternalResearchPrompt('Erro no Office com fonte externa nao confiavel.');

    expect(() => buildExternalResearchCandidate(sanitized, [
      { url: 'https://reddit.com/r/sysadmin/comments/1' },
    ], catalog)).toThrow('EXTERNAL_RESEARCH_SOURCE_NOT_ALLOWLISTED');
  });

  it('keeps low confidence external research as suggested_low_confidence without auto publish', () => {
    const sanitized = sanitizeExternalResearchPrompt('Office nao ativa com erro generico em fonte nao oficial.');
    const candidate = buildExternalResearchCandidate(sanitized, [
      { url: 'https://support.example.net/office/activation-case', title: 'Forum validado pelo supervisor' },
    ], lowConfidenceCatalog);

    expect(candidate.status).toBe('suggested_low_confidence');
    expect(candidate.confidenceScore).toBeLessThan(70);
    expect(candidate.sourceConfidenceLevel).toBe('low_confidence');
    expect(candidate.lowConfidenceReason).toContain('Confiança abaixo de 70');
    expect(candidate.autoPublish).toBe(false);
    expect(candidate.humanReviewRequired).toBe(true);
  });
});
