export type InactivityTrackingStatus =
  | 'pending'
  | 'reminder_1_sent'
  | 'reminder_2_sent'
  | 'reminder_3_sent'
  | 'autoclose_done'
  | 'skipped_by_response'
  | 'skipped_by_hold'
  | 'skipped_by_closed_ticket'
  | 'skipped_by_feature_flag'
  | 'failed';

export interface InactivityTrackingRecord {
  conversationId: string;
  ticketId: number | null;
  conversationStatus: string | null;
  phoneE164: string | null;
  status: InactivityTrackingStatus;
  reminder1SentAt: Date | null;
  reminder2SentAt: Date | null;
  reminder3SentAt: Date | null;
  autocloseAttemptedAt: Date | null;
  autocloseCompletedAt: Date | null;
  lastClientActivityAt: Date | null;
  lastOutboundActivityAt: Date | null;
  manualHoldUntil: Date | null;
  manualHoldReason: string | null;
  skipReason: string | null;
  updatedAt: Date;
}

export interface TrackOutboundActivityInput {
  conversationId: string;
  ticketId: number;
  occurredAt: Date;
}

export interface ProfileCollectionReminderCandidate {
  conversationId: string;
  phoneE164: string;
  conversationStatus: string;
  profileCollectionState: Record<string, unknown>;
  lastMessageAt: Date;
  updatedAt: Date;
}

export interface InactivityTrackingRepository {
  trackOutboundActivity(input: TrackOutboundActivityInput): Promise<void>;
  findDueCandidates(limit: number): Promise<InactivityTrackingRecord[]>;
  findProfileCollectionReminderCandidates(
    reminderCutoff: Date,
    autocloseCutoff: Date,
    limit: number,
  ): Promise<ProfileCollectionReminderCandidate[]>;
  findByConversationId(conversationId: string): Promise<InactivityTrackingRecord | null>;
  markProfileCollectionReminderSent(conversationId: string, step: string, sentAt: Date): Promise<boolean>;
  cancelProfileCollectionConversation(
    conversationId: string,
    step: string,
    cancelledAt: Date,
    reason: 'preticket_timeout',
  ): Promise<boolean>;
  markReminderSent(conversationId: string, reminderNumber: 1 | 2 | 3, sentAt: Date): Promise<void>;
  tryMarkAutocloseAttempted(conversationId: string, attemptedAt: Date): Promise<boolean>;
  markAutocloseCompleted(conversationId: string, completedAt: Date): Promise<void>;
  markSkipped(conversationId: string, status: InactivityTrackingStatus, reason: string): Promise<void>;
  markFailed(conversationId: string, reason: string): Promise<void>;
  setManualHold(conversationId: string, holdUntil: Date | null, reason: string | null): Promise<void>;
}
