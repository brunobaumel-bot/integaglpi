import { buildExternalResearchCandidate } from '../../externalResearch/candidateBuilder.js';
import { sanitizeExternalResearchPrompt } from '../../externalResearch/sanitizer.js';
import { validateExternalResearchSource } from '../../externalResearch/sourceValidator.js';
import type {
  ExternalResearchCandidate,
  ExternalResearchSourceInput,
  ExternalSourceCatalogEntry,
  SourceValidationResult,
} from '../../externalResearch/types.js';

export class ExternalResearchService {
  public preview(prompt: string): ReturnType<typeof sanitizeExternalResearchPrompt> {
    return sanitizeExternalResearchPrompt(prompt);
  }

  public validateSources(urls: string[], catalog: ExternalSourceCatalogEntry[]): SourceValidationResult[] {
    return urls.map((url) => validateExternalResearchSource(url, catalog));
  }

  public buildCandidate(
    prompt: string,
    sources: ExternalResearchSourceInput[],
    catalog: ExternalSourceCatalogEntry[],
  ): ExternalResearchCandidate {
    const sanitized = sanitizeExternalResearchPrompt(prompt);
    if (sanitized.blocked) {
      throw new Error(sanitized.blockedReason ?? 'EXTERNAL_RESEARCH_PAYLOAD_BLOCKED');
    }

    return buildExternalResearchCandidate(sanitized, sources, catalog);
  }
}
