export const WEBHOOK_PROCESSING_STATUSES = [
  'received',
  'processed',
  'failed',
  'duplicate',
  'ignored',
] as const;

export type WebhookProcessingStatus = (typeof WEBHOOK_PROCESSING_STATUSES)[number];
