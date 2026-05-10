export type AuditSeverity = 'info' | 'warning' | 'error' | 'critical';
export type AuditStatus = 'success' | 'failed' | 'ignored' | 'duplicated' | 'pending';

export interface AuditEventInput {
  correlationId?: string | null;
  ticketId?: number | null;
  conversationId?: string | null;
  messageId?: string | null;
  direction?: string | null;
  eventType: string;
  status: AuditStatus;
  severity: AuditSeverity;
  source: string;
  payload?: unknown;
  errorMessage?: string | null;
}

export interface AuditEventRepository {
  create(input: AuditEventInput): Promise<void>;
}
