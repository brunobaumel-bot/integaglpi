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
  contactId: string;
  queueId: number | null;
  glpiEntityId: number | null;
  glpiEntityName: string | null;
  profileCollectionState: Record<string, unknown>;
  lastMessageAt: Date;
  updatedAt: Date;
}

export interface PendingCsatTimeoutCandidate {
  solutionActionId: string;
  conversationId: string;
  ticketId: number;
  phoneE164: string;
  createdAt: Date;
  latestInboundAt: Date | null;
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
  markProfileCollectionSecondReminderSent(conversationId: string, step: string, sentAt: Date): Promise<boolean>;
  tryReserveProfileCollectionTimeout(conversationId: string, step: string, attemptedAt: Date): Promise<boolean>;
  markProfileCollectionTicketOpened(
    conversationId: string,
    ticketId: number,
    openedAt: Date,
    glpiEntityId: number,
    glpiEntityName: string | null,
  ): Promise<void>;
  markProfileCollectionAttentionRequired(conversationId: string, reason: string, occurredAt: Date): Promise<void>;
  cancelProfileCollectionConversation(
    conversationId: string,
    step: string,
    cancelledAt: Date,
    reason: 'preticket_timeout',
  ): Promise<boolean>;
  findPendingCsatTimeoutCandidates(cutoff: Date, limit: number): Promise<PendingCsatTimeoutCandidate[]>;
  tryReserveCsatTimeoutClose(solutionActionId: string, attemptedAt: Date): Promise<boolean>;
  markCsatTimeoutClosed(solutionActionId: string, closedAt: Date): Promise<void>;
  markCsatTimeoutSkipped(solutionActionId: string, reason: string): Promise<void>;
  markReminderSent(conversationId: string, reminderNumber: 1 | 2 | 3, sentAt: Date): Promise<void>;
  tryMarkAutocloseAttempted(conversationId: string, attemptedAt: Date): Promise<boolean>;
  markAutocloseCompleted(conversationId: string, completedAt: Date): Promise<void>;
  markSkipped(conversationId: string, status: InactivityTrackingStatus, reason: string): Promise<void>;
  markFailed(conversationId: string, reason: string): Promise<void>;
  setManualHold(conversationId: string, holdUntil: Date | null, reason: string | null): Promise<void>;
}
