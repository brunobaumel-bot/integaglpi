import type { ExternalSourceCatalogEntry, SourceValidationResult } from './types.js';

function hostnameFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return null;
    }
    return parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function patternMatches(hostname: string, pattern: string): boolean {
  const normalized = pattern.trim().toLowerCase();
  if (normalized.startsWith('*.')) {
    const suffix = normalized.slice(2);
    return hostname === suffix || hostname.endsWith(`.${suffix}`);
  }
  return hostname === normalized;
}

export function validateExternalResearchSource(
  url: string,
  catalog: ExternalSourceCatalogEntry[],
): SourceValidationResult {
  const hostname = hostnameFromUrl(url);
  if (!hostname) {
    return {
      allowed: false,
      blockedReason: 'EXTERNAL_RESEARCH_SOURCE_INVALID_URL',
      matchedSource: null,
      confidenceScore: 0,
      confidenceLevel: 'blocked',
      warnings: ['URL inválida ou protocolo não permitido.'],
    };
  }

  const matched = catalog
    .filter((source) => source.enabled)
    .sort((a, b) => a.priority - b.priority)
    .find((source) => patternMatches(hostname, source.urlPattern));

  if (!matched) {
    return {
      allowed: false,
      blockedReason: 'EXTERNAL_RESEARCH_SOURCE_NOT_ALLOWLISTED',
      matchedSource: null,
      confidenceScore: 0,
      confidenceLevel: 'blocked',
      warnings: ['Fonte fora do catálogo permitido.'],
    };
  }

  const base = matched.officialFlag ? 70 : matched.sourceType === 'low_confidence' ? 35 : 55;
  const confidenceScore = Math.max(0, Math.min(100, base + matched.confidenceBoost));
  const warnings: string[] = [];
  if (matched.sourceType === 'low_confidence') {
    warnings.push('Fonte cadastrada como baixa confiança; validação humana reforçada obrigatória.');
  }
  if (matched.requiresVerification) {
    warnings.push('Verifique versão e data antes de usar o procedimento.');
  }

  return {
    allowed: true,
    blockedReason: null,
    matchedSource: matched,
    confidenceScore,
    confidenceLevel: matched.officialFlag ? 'official' : matched.sourceType === 'low_confidence' ? 'low_confidence' : 'verified',
    warnings,
  };
}

export function detectSourceConflicts(validations: SourceValidationResult[]): string[] {
  const conflicts: string[] = [];
  const allowed = validations.filter((validation) => validation.allowed && validation.matchedSource !== null);
  if (allowed.length < 2) {
    return conflicts;
  }

  const hasOfficial = allowed.some((validation) => validation.matchedSource?.officialFlag === true);
  const hasLowConfidence = allowed.some((validation) => validation.matchedSource?.sourceType === 'low_confidence');
  if (hasOfficial && hasLowConfidence) {
    conflicts.push('Fonte oficial e fonte de baixa confiança foram fornecidas; priorizar documentação oficial.');
  }

  const sourceTypes = new Set(allowed.map((validation) => validation.matchedSource?.sourceType));
  if (sourceTypes.size > 1) {
    conflicts.push('Fontes de tipos diferentes exigem validação humana de versão e escopo.');
  }

  return conflicts;
}
