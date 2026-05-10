import type { WebhookEvent } from '../../domain/entities/WebhookEvent.js';
import type { WebhookProcessingStatus } from '../../domain/types/WebhookProcessingStatus.js';

export interface CreateWebhookEventInput {
  eventId: string;
  eventType: string;
  payload: unknown;
  signatureValid: boolean;
  processingStatus: WebhookProcessingStatus;
}

export interface WebhookEventRepository {
  create(input: CreateWebhookEventInput): Promise<WebhookEvent>;
  updateStatus(eventId: string, processingStatus: WebhookProcessingStatus): Promise<void>;
}

