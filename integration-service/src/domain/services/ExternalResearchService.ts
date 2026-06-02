import { buildExternalResearchCandidate } from '../../externalResearch/candidateBuilder.js';
import { sanitizeExternalResearchPrompt } from '../../externalResearch/sanitizer.js';
import { validateExternalResearchSource } from '../../externalResearch/sourceValidator.js';
import type {
  ExternalResearchCandidate,
  ExternalResearchSourceInput,
  ExternalSourceCatalogEntry,
  SourceValidationResult,
} from '../../externalResearch/types.js';
import type {
  CloudAuditRepository,
  CloudResearchAuditInput,
} from '../../repositories/postgres/PostgresCloudAuditRepository.js';

/** Structured cloud research answer surfaced to the technician for review. */
export interface DynamicResearchAnswer {
  diagnosis: string;
  steps: string[];
  risks: string[];
  commands: string[];
  confirmationQuestions: string[];
  references: string[];
}

/** Injected cloud provider — must be called ONLY after an explicit human click. */
export interface CloudResearchProvider {
  research(sanitizedContext: string): Promise<DynamicResearchAnswer>;
}

export interface DynamicResearchInput {
  /** Raw ticket context — will be sanitized before anything leaves the service. */
  context: string;
  ticketId: number | null;
  profileId: number | null;
  category: string | null;
  provider?: string | null;
  /** MUST be true — proves an explicit human click reached this call. */
  humanConsent: boolean;
}

export interface DynamicResearchResult {
  ok: boolean;
  status: 'completed' | 'blocked_pii' | 'no_consent' | 'provider_unavailable' | 'failed';
  message: string;
  answer: DynamicResearchAnswer | null;
  /** Sanitizer detected kinds (for transparency). */
  piiDetectedKinds: string[];
}

export class ExternalResearchService {
  /**
   * @param cloudProvider injected cloud client; called ONLY after consent + sanitization
   * @param cloudAudit    cloud_compliance_audit writer
   * @param cloudEnabled  EXTERNAL_RESEARCH_CLOUD_ENABLED feature flag (default false).
   *                      When false (or no provider) the dynamic search returns an
   *                      informative 'provider_unavailable' instead of a generic failure.
   */
  public constructor(
    private readonly cloudProvider?: CloudResearchProvider,
    private readonly cloudAudit?: CloudAuditRepository,
    private readonly cloudEnabled: boolean = false,
  ) {}

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

  /**
   * Dynamic (catalog-free) cloud research. Local-first is enforced upstream by
   * SmartHelpService; this is only ever reached after the technician explicitly
   * clicks "Pesquisar fora".
   *
   * Guarantees:
   *  - Requires humanConsent === true (no cloud without an explicit click).
   *  - Sanitizes the context with the EXISTING sanitizer; if PII/secret is
   *    detected the call is BLOCKED and never sent to the cloud.
   *  - Records a cloud_compliance_audit row (metadata only — no raw prompt/PII).
   */
  public async researchDynamic(input: DynamicResearchInput): Promise<DynamicResearchResult> {
    if (input.humanConsent !== true) {
      return {
        ok: false,
        status: 'no_consent',
        message: 'Pesquisa externa exige confirmação explícita do técnico.',
        answer: null,
        piiDetectedKinds: [],
      };
    }

    const sanitized = sanitizeExternalResearchPrompt(input.context);

    if (sanitized.blocked) {
      // PII/secret detected → never sent to cloud; record the blocked attempt.
      await this.safeAudit({
        glpiTicketId: input.ticketId,
        glpiProfileId: input.profileId,
        category: input.category,
        provider: input.provider ?? null,
        piiGuardPassed: false,
        piiDetectedKinds: sanitized.detectedKinds,
        requestContextChars: sanitized.sanitizedText.length,
        requestSummarySanitized: null,
        inputHash: sanitized.inputHash,
        status: 'blocked',
      });
      return {
        ok: false,
        status: 'blocked_pii',
        message: 'Contexto contém dados sensíveis e não foi enviado à nuvem.',
        answer: null,
        piiDetectedKinds: sanitized.detectedKinds,
      };
    }

    // Feature flag / provider gate. Sanitization + consent already passed; the
    // payload is safe, but the cloud step is unavailable. Return an informative
    // message (not a generic failure) AND record the blocked attempt for audit.
    if (!this.cloudEnabled || !this.cloudProvider) {
      await this.safeAudit({
        glpiTicketId: input.ticketId,
        glpiProfileId: input.profileId,
        category: input.category,
        provider: input.provider ?? null,
        piiGuardPassed: true,
        piiDetectedKinds: sanitized.detectedKinds,
        requestContextChars: sanitized.sanitizedText.length,
        requestSummarySanitized: sanitized.sanitizedText.slice(0, 1_000),
        inputHash: sanitized.inputHash,
        status: 'blocked',
      });
      return {
        ok: false,
        status: 'provider_unavailable',
        message: 'Pesquisa externa não configurada. Contate o administrador.',
        answer: null,
        piiDetectedKinds: sanitized.detectedKinds,
      };
    }

    const auditId = await this.safeAudit({
      glpiTicketId: input.ticketId,
      glpiProfileId: input.profileId,
      category: input.category,
      provider: input.provider ?? null,
      piiGuardPassed: true,
      piiDetectedKinds: sanitized.detectedKinds,
      requestContextChars: sanitized.sanitizedText.length,
      requestSummarySanitized: sanitized.sanitizedText.slice(0, 1_000),
      inputHash: sanitized.inputHash,
      status: 'requested',
    });

    try {
      const answer = await this.cloudProvider.research(sanitized.sanitizedText);
      if (auditId > 0) {
        await this.cloudAudit?.recordResponse({
          auditId,
          responseSummary: answer.diagnosis.slice(0, 2_000),
          status: 'responded',
        }).catch(() => undefined);
      }
      return {
        ok: true,
        status: 'completed',
        message: '',
        answer,
        piiDetectedKinds: sanitized.detectedKinds,
      };
    } catch {
      if (auditId > 0) {
        await this.cloudAudit?.recordResponse({ auditId, responseSummary: null, status: 'failed' }).catch(() => undefined);
      }
      return {
        ok: false,
        status: 'failed',
        message: 'Pesquisa externa indisponível no momento.',
        answer: null,
        piiDetectedKinds: sanitized.detectedKinds,
      };
    }
  }

  private async safeAudit(input: CloudResearchAuditInput): Promise<number> {
    try {
      return (await this.cloudAudit?.recordRequest(input)) ?? 0;
    } catch {
      return 0;
    }
  }
}
