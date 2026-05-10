import { logger } from '../../infra/logger/logger.js';
import type { AuditEventInput, AuditEventRepository } from '../../repositories/contracts/AuditEventRepository.js';
import { sanitizeAuditPayload } from './auditPayloadSanitizer.js';
import { normalizeCorrelationId } from './correlationId.js';

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 500);
}

function normalizeAuditEvent(input: AuditEventInput): AuditEventInput {
  return {
    ...input,
    correlationId: normalizeCorrelationId(input.correlationId) ?? null,
    payload: input.payload === undefined ? undefined : sanitizeAuditPayload(input.payload),
    errorMessage: input.errorMessage ? input.errorMessage.slice(0, 1_000) : null,
  };
}

export class AuditService {
  public constructor(private readonly repository: AuditEventRepository) {}

  public async recordAuditEvent(input: AuditEventInput): Promise<void> {
    await this.repository.create(normalizeAuditEvent(input));
  }

  public async recordAuditEventSafe(input: AuditEventInput): Promise<void> {
    try {
      await this.recordAuditEvent(input);
    } catch (error: unknown) {
      logger.error(
        {
          event_type: 'AUDIT_WRITE_FAILED',
          status: 'failed',
          severity: 'error',
          correlation_id: normalizeCorrelationId(input.correlationId),
          source: 'AuditService',
          audit_event_type: input.eventType,
          error_message: safeErrorMessage(error),
        },
        '[integration-service][audit][AUDIT_WRITE_FAILED]',
      );
    }
  }

  public recordAuditEventFireAndForget(input: AuditEventInput): void {
    void this.recordAuditEventSafe(input);
  }
}
