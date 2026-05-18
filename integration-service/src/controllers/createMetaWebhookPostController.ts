import type { Request, Response } from 'express';

import { metaWebhookPayloadSchema } from '../adapters/meta/metaWebhookTypes.js';
import type { MetaWebhookPayload } from '../adapters/meta/metaWebhookTypes.js';
import type { AuditService } from '../domain/services/AuditService.js';
import type { InboundWebhookService } from '../domain/services/InboundWebhookService.js';
import { getOrCreateCorrelationId } from '../domain/services/correlationId.js';
import { logger } from '../infra/logger/logger.js';

function maskIdentifier(value: string | undefined): string | null {
  const normalized = String(value ?? '').trim();
  if (normalized === '') {
    return null;
  }

  if (normalized.length <= 4) {
    return '*'.repeat(normalized.length);
  }

  return `${'*'.repeat(Math.max(4, normalized.length - 4))}${normalized.slice(-4)}`;
}

function parseCsvEnv(value: string | undefined): string[] {
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

function normalizeDisplayPhoneNumber(value: string | undefined): string {
  return String(value ?? '').replace(/\D/g, '');
}

function inferEventType(payload: MetaWebhookPayload): 'message' | 'status' | 'unknown' {
  let hasMessage = false;
  let hasStatus = false;

  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      if ((change.value.messages?.length ?? 0) > 0) {
        hasMessage = true;
      }
      if ((change.value.statuses?.length ?? 0) > 0) {
        hasStatus = true;
      }
    }
  }

  if (hasMessage && !hasStatus) {
    return 'message';
  }
  if (hasStatus && !hasMessage) {
    return 'status';
  }

  return 'unknown';
}

interface MetaPhoneGuardPolicy {
  allowedPhoneNumberIds: string[];
  allowedDisplayPhoneNumbers: string[];
  phoneNumberIdsConfigured: boolean;
  displayPhoneNumbersConfigured: boolean;
  legacyAllowedPhoneIdSupported: boolean;
}

function getMetaPhoneGuardPolicy(): MetaPhoneGuardPolicy {
  const configuredPhoneNumberIds = parseCsvEnv(process.env.ALLOWED_META_PHONE_NUMBER_IDS);
  const legacyPhoneNumberIds = configuredPhoneNumberIds.length === 0
    ? parseCsvEnv(process.env.ALLOWED_META_PHONE_ID)
    : [];

  return {
    allowedPhoneNumberIds: configuredPhoneNumberIds.length > 0 ? configuredPhoneNumberIds : legacyPhoneNumberIds,
    allowedDisplayPhoneNumbers: parseCsvEnv(process.env.ALLOWED_META_DISPLAY_PHONE_NUMBERS)
      .map(normalizeDisplayPhoneNumber)
      .filter((item) => item !== ''),
    phoneNumberIdsConfigured: configuredPhoneNumberIds.length > 0 || legacyPhoneNumberIds.length > 0,
    displayPhoneNumbersConfigured: parseCsvEnv(process.env.ALLOWED_META_DISPLAY_PHONE_NUMBERS).length > 0,
    legacyAllowedPhoneIdSupported: legacyPhoneNumberIds.length > 0,
  };
}

interface MetaPhoneGuardResult {
  allowed: boolean;
  reason?: 'not_configured' | 'missing_metadata' | 'unauthorized_number';
  receivedPhoneIds: string[];
  receivedDisplayPhoneNumbers: string[];
  eventType: 'message' | 'status' | 'unknown';
  policy: MetaPhoneGuardPolicy;
}

function evaluateMetaPhoneGuard(payload: MetaWebhookPayload): MetaPhoneGuardResult {
  const policy = getMetaPhoneGuardPolicy();
  const eventType = inferEventType(payload);
  const receivedPhoneIds: string[] = [];
  const receivedDisplayPhoneNumbers: string[] = [];

  if (!policy.phoneNumberIdsConfigured) {
    return {
      allowed: false,
      reason: 'not_configured',
      receivedPhoneIds,
      receivedDisplayPhoneNumbers,
      eventType,
      policy,
    };
  }

  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      const metadata = change.value.metadata;
      const phoneNumberId = String(metadata?.phone_number_id ?? '').trim();
      const displayPhoneNumber = String(metadata?.display_phone_number ?? '').trim();
      const normalizedDisplayPhoneNumber = normalizeDisplayPhoneNumber(displayPhoneNumber);

      if (phoneNumberId === '') {
        return {
          allowed: false,
          reason: 'missing_metadata',
          receivedPhoneIds,
          receivedDisplayPhoneNumbers,
          eventType,
          policy,
        };
      }

      receivedPhoneIds.push(phoneNumberId);
      if (normalizedDisplayPhoneNumber !== '') {
        receivedDisplayPhoneNumbers.push(normalizedDisplayPhoneNumber);
      }

      if (!policy.allowedPhoneNumberIds.includes(phoneNumberId)) {
        return {
          allowed: false,
          reason: 'unauthorized_number',
          receivedPhoneIds,
          receivedDisplayPhoneNumbers,
          eventType,
          policy,
        };
      }

      if (policy.displayPhoneNumbersConfigured) {
        if (normalizedDisplayPhoneNumber === '' || !policy.allowedDisplayPhoneNumbers.includes(normalizedDisplayPhoneNumber)) {
          return {
            allowed: false,
            reason: 'unauthorized_number',
            receivedPhoneIds,
            receivedDisplayPhoneNumbers,
            eventType,
            policy,
          };
        }
      }
    }
  }

  return {
    allowed: true,
    receivedPhoneIds,
    receivedDisplayPhoneNumbers,
    eventType,
    policy,
  };
}

function logDroppedWebhook(
  guardResult: MetaPhoneGuardResult,
  correlationId: string,
): void {
  const eventName = guardResult.reason === 'missing_metadata'
    ? 'DROPPED_MISSING_META_METADATA'
    : guardResult.reason === 'not_configured'
      ? 'META_PHONE_GUARD_NOT_CONFIGURED'
      : 'DROPPED_UNAUTHORIZED_NUMBER';

  logger.warn(
    {
      correlation_id: correlationId,
      event_type: eventName,
      status: 'ignored',
      source: 'MetaWebhookPostController',
      reason: guardResult.reason,
      webhook_event_type: guardResult.eventType,
      expected_policy: guardResult.policy.displayPhoneNumbersConfigured
        ? 'allowed_phone_number_ids_and_display_phone_numbers_configured'
        : 'allowed_phone_number_ids_configured',
      received_phone_ids_masked: guardResult.receivedPhoneIds.map(maskIdentifier),
      received_display_phone_numbers_masked: guardResult.receivedDisplayPhoneNumbers.map(maskIdentifier),
      legacy_allowed_phone_id_supported: guardResult.policy.legacyAllowedPhoneIdSupported,
    },
    `[integration-service][security][${eventName}]`,
  );
}

export function createMetaWebhookPostController(
  inboundWebhookService: InboundWebhookService,
  auditService?: AuditService,
) {
  return async function metaWebhookPostController(req: Request, res: Response): Promise<void> {
    const correlationId = getOrCreateCorrelationId(req.header('x-correlation-id'));
    const parsedPayload = metaWebhookPayloadSchema.safeParse(req.body);

    if (!parsedPayload.success) {
      res.status(400).json({
        error: 'invalid_meta_payload',
      });
      return;
    }

    try {
      const guardResult = evaluateMetaPhoneGuard(parsedPayload.data);
      if (!guardResult.allowed) {
        logDroppedWebhook(guardResult, correlationId);
        res.status(200).json({
          status: 'ignored',
          ignored: true,
          reason: guardResult.reason,
        });
        return;
      }

      auditService?.recordAuditEventFireAndForget({
        correlationId,
        eventType: 'WEBHOOK_RECEIVED',
        status: 'success',
        severity: 'info',
        source: 'MetaWebhookPostController',
        payload: {
          object: parsedPayload.data.object,
          entry_count: parsedPayload.data.entry.length,
        },
      });
      logger.info(
        {
          correlation_id: correlationId,
          event_type: 'WEBHOOK_RECEIVED',
          status: 'success',
          source: 'MetaWebhookPostController',
          webhook_event_type: guardResult.eventType,
        },
        '[integration-service][webhook][RECEIVED]',
      );

      const result = await inboundWebhookService.process(parsedPayload.data, { correlationId });

      res.status(200).json({
        status: 'accepted',
        results: result.results,
      });
    } catch (error: unknown) {
      logger.error(
        { correlation_id: correlationId, event_type: 'WEBHOOK_PROCESSING_FAILED', status: 'failed', source: 'MetaWebhookPostController', error },
        'Failed to persist or process inbound Meta webhook.',
      );

      res.status(500).json({
        error: 'webhook_processing_failed',
      });
    }
  };
}
