export const MESSAGE_PROCESSING_STATUSES = [
  'received',
  'processing',
  'processed',
  'failed',
  'duplicate',
  /** Outbound successfully handed off (mock or Meta). */
  'sent',
] as const;

export type MessageProcessingStatus = (typeof MESSAGE_PROCESSING_STATUSES)[number];
