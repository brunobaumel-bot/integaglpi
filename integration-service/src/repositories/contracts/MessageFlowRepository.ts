export type ConfiguredMessageSendType =
  | 'text'
  | 'interactive_buttons'
  | 'interactive_list'
  | 'template'
  | 'internal_only';

export interface ConfiguredMessage {
  eventKey: string;
  description: string;
  groupName: string;
  defaultText: string;
  customText: string | null;
  isActive: boolean;
  sendType: ConfiguredMessageSendType;
  language: string;
  fallbackText: string | null;
  templateName: string | null;
  buttons: Array<{ id: string; title: string }>;
  listOptions: Array<{ id: string; title: string; description?: string }>;
  expectsResponse: boolean;
  updatedAt: Date | null;
  updatedBy: number | null;
}

export interface BusinessHoursConfigRecord {
  enabled: boolean;
  timezone: string;
  weekdayStart: string;
  weekdayEnd: string;
  saturdayEnabled: boolean;
  saturdayStart: string | null;
  saturdayEnd: string | null;
  sundayEnabled: boolean;
  sundayStart: string | null;
  sundayEnd: string | null;
  holidayBehavior: 'closed' | 'normal' | 'custom';
  eventKey: string;
  cooldownMinutes: number;
}

export interface RecordAutomationEventInput {
  conversationId: string | null;
  phoneE164: string | null;
  eventKey: string;
  status: 'planned' | 'sent' | 'failed' | 'not_sent_by_rule';
  messageId?: string | null;
  reason?: string | null;
  errorCode?: string | null;
  errorMessageSanitized?: string | null;
}

export interface RecordInactivityJobEventInput {
  conversationId: string | null;
  ticketId?: number | null;
  phoneE164: string | null;
  eventKey?: string | null;
  status: 'checked' | 'eligible' | 'skipped' | 'planned' | 'sent' | 'failed';
  reason?: string | null;
  messageId?: string | null;
  deliveryStatus?: string | null;
  metaErrorCode?: string | null;
  metaErrorMessageSanitized?: string | null;
  checkedCount?: number | null;
  eligibleCount?: number | null;
}

export interface MessageFlowRepository {
  findMessageByEventKey(eventKey: string): Promise<ConfiguredMessage | null>;
  findBusinessHoursConfig(): Promise<BusinessHoursConfigRecord | null>;
  findLastAutomationEvent(
    conversationId: string | null,
    phoneE164: string | null,
    eventKey: string,
    statuses: Array<RecordAutomationEventInput['status']>,
  ): Promise<Date | null>;
  recordAutomationEvent(input: RecordAutomationEventInput): Promise<void>;
  recordInactivityJobEvent(input: RecordInactivityJobEventInput): Promise<void>;
}
