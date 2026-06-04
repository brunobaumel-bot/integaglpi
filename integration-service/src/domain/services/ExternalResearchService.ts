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
  /**
   * PII Guard policy. 'detected' (default) blocks on any detected kind (raw/legacy).
   * 'residual' rewrites the summary into a cloud-safe technical context and blocks
   * only on residual PII. The controller selects this from the safety feature flag.
   */
  policy?: 'detected' | 'residual';
}

export interface DynamicResearchResult {
  ok: boolean;
  status: 'completed' | 'blocked_pii' | 'no_consent' | 'provider_unavailable' | 'no_actionable_result' | 'failed';
  message: string;
  answer: DynamicResearchAnswer | null;
  /** Sanitizer detected kinds (for transparency). */
  piiDetectedKinds: string[];
  /** True only when the answer carries usable technical guidance (diagnosis + steps). */
  actionable: boolean;
}

/** An answer is actionable only if it gives a diagnosis AND at least one concrete step. */
export function isActionableAnswer(answer: DynamicResearchAnswer | null): boolean {
  if (answer === null) {
    return false;
  }
  const hasDiagnosis = typeof answer.diagnosis === 'string' && answer.diagnosis.trim().length >= 10;
  const hasSteps = Array.isArray(answer.steps) && answer.steps.filter((s) => String(s).trim() !== '').length > 0;
  return hasDiagnosis && hasSteps;
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

  /** Max length of the cloud-safe technical context (chars). */
  private static readonly CLOUD_SAFE_MAX_CHARS = 600;

  /**
   * Hardened residual-PII detector run on the FINAL rewritten text. Independent from
   * the sanitizer's own residual check — defense in depth. If any of these survive a
   * double sanitize pass, the text is NOT cloud-safe.
   */
  private static readonly RESIDUAL_PII =
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:password|senha|token|api[_-]?key|app[_-]?secret|secret)\s*[:=]\s*\S{4,}|\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b|\b(?:\+?55\s?)?\(?\d{2}\)?\s?9?\d{4}[-.\s]?\d{4}\b|\b(?:[a-z0-9-]+\.)+(?:local|lan|corp|internal|intra)\b/i;

  private residualPiiPresent(text: string): boolean {
    return ExternalResearchService.RESIDUAL_PII.test(text);
  }

  /**
   * Build a CLOUD-SAFE technical context from the technician's local summary.
   *
   * Deterministic-first and never trusts AI as the sole filter:
   *   1. sanitize (deterministic redaction of email/phone/cpf/cnpj/name/secret/...)
   *   2. sanitize again (idempotent second pass — catches anything re-exposed)
   *   3. cap length
   *   4. independent hardened residual check
   *
   * The raw ticket context, history and ticket object are NEVER used here — only the
   * already-sanitized local summary text passed in. Returns metadata + the cloud-safe
   * text only; the caller never receives the raw input back.
   */
  public rewriteCloudSafe(summary: string): {
    cloudSafeContext: string;
    safeForCloudResidual: boolean;
    safeForCloudStrict: boolean;
    detectedKinds: string[];
    removedKinds: string[];
    blockedReason: string | null;
    payloadHash: string;
    charCount: number;
    source: 'summary_rewrite';
  } {
    const pass1 = sanitizeExternalResearchPrompt(String(summary ?? ''));
    const pass2 = sanitizeExternalResearchPrompt(pass1.sanitizedText);
    const finalText = pass2.sanitizedText.slice(0, ExternalResearchService.CLOUD_SAFE_MAX_CHARS).trim();
    const detectedKinds = [...new Set([...pass1.detectedKinds, ...pass2.detectedKinds])].sort();
    const residual = this.residualPiiPresent(finalText);
    return {
      cloudSafeContext: finalText,
      // block-on-residual: only real residual PII blocks (placeholders are fine).
      safeForCloudResidual: !residual && finalText !== '',
      // block-on-detected: strict legacy mode (any detected kind blocks).
      safeForCloudStrict: detectedKinds.length === 0 && finalText !== '',
      detectedKinds,
      removedKinds: detectedKinds,
      blockedReason: residual ? 'RESIDUAL_PII_AFTER_REWRITE' : (finalText === '' ? 'EMPTY_AFTER_REWRITE' : null),
      payloadHash: pass2.anonymizedPayloadHash,
      charCount: finalText.length,
      source: 'summary_rewrite',
    };
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
        actionable: false,
      };
    }

    // Cloud-safe policy. 'residual' (rewritten path): rewrite the local summary into a
    // generic technical context and block only if residual PII survives. 'detected'
    // (default/legacy, raw path): block if ANY PII kind is detected. The rewrite never
    // uses raw ticket content — only the summary text passed in input.context.
    const policy = input.policy === 'residual' ? 'residual' : 'detected';
    const effectiveContext = policy === 'residual'
      ? this.rewriteCloudSafe(input.context).cloudSafeContext
      : input.context;

    const sanitized = sanitizeExternalResearchPrompt(effectiveContext);
    const blocked = policy === 'residual'
      ? this.residualPiiPresent(sanitized.sanitizedText) || sanitized.sanitizedText.trim() === ''
      : sanitized.blocked;

    if (blocked) {
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
        actionable: false,
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
        actionable: false,
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
      const actionable = isActionableAnswer(answer);
      if (auditId > 0) {
        await this.cloudAudit?.recordResponse({
          auditId,
          responseSummary: (answer?.diagnosis ?? '').slice(0, 2_000),
          status: 'responded',
        }).catch(() => undefined);
      }

      // The provider answered, but with no usable technical guidance (no
      // diagnosis + no concrete steps). Do NOT report this as a success and do
      // NOT expose it as a candidate to publish — return a clear, honest status
      // so the panel shows "nothing useful" instead of a process report.
      if (!actionable) {
        return {
          ok: false,
          status: 'no_actionable_result',
          message: 'A pesquisa não retornou orientação técnica utilizável.',
          answer: null,
          piiDetectedKinds: sanitized.detectedKinds,
          actionable: false,
        };
      }

      return {
        ok: true,
        status: 'completed',
        message: '',
        answer,
        piiDetectedKinds: sanitized.detectedKinds,
        actionable: true,
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
        actionable: false,
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
