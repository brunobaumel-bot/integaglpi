import type { WebhookProcessingStatus } from '../types/WebhookProcessingStatus.js';

export interface WebhookEvent {
  eventId: string;
  eventType: string;
  payload: unknown;
  signatureValid: boolean;
  receivedAt: Date;
  processingStatus: WebhookProcessingStatus;
  createdAt: Date;
}

