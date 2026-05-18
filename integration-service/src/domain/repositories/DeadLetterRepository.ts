export interface DeadLetterAppendInput {
  correlationId?: string | null;
  conversationId?: string | null;
  messageId?: string | null;
  ticketId?: number | null;
  operationType: string;
  failureType: string;
  failureReason?: string | null;
  payloadJson?: Record<string, unknown> | null;
  status?: string;
}

export interface DeadLetterRepository {
  append(input: DeadLetterAppendInput): Promise<string>;
}
