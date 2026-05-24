import { describe, expect, it } from 'vitest';

import { detectSourceConflicts, validateExternalResearchSource } from '../src/externalResearch/sourceValidator.js';
import type { ExternalSourceCatalogEntry } from '../src/externalResearch/types.js';

const catalog: ExternalSourceCatalogEntry[] = [
  {
    id: 1,
    sourceKey: 'microsoft',
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
  {
    id: 2,
    sourceKey: 'forum',
    name: 'Forum validado',
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

describe('external research source validator', () => {
  it('allows official allowlisted documentation and boosts confidence', () => {
    const result = validateExternalResearchSource('https://learn.microsoft.com/pt-br/microsoft-365/troubleshoot', catalog);

    expect(result.allowed).toBe(true);
    expect(result.matchedSource?.sourceKey).toBe('microsoft');
    expect(result.confidenceLevel).toBe('official');
    expect(result.confidenceScore).toBeGreaterThanOrEqual(70);
  });

  it('blocks sources outside the catalog', () => {
    const result = validateExternalResearchSource('https://stackoverflow.com/questions/123', catalog);

    expect(result.allowed).toBe(false);
    expect(result.blockedReason).toBe('EXTERNAL_RESEARCH_SOURCE_NOT_ALLOWLISTED');
  });

  it('detects official versus low confidence conflicts', () => {
    const validations = [
      validateExternalResearchSource('https://learn.microsoft.com/example', catalog),
      validateExternalResearchSource('https://post.example.net/thread', catalog),
    ];

    expect(detectSourceConflicts(validations)).toContain('Fonte oficial e fonte de baixa confiança foram fornecidas; priorizar documentação oficial.');
  });
});
