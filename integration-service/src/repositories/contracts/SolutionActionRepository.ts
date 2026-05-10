export type SolutionActionType = 'approve' | 'reopen';
export type SolutionActionStatus = 'processing' | 'success' | 'error' | 'ignored';

export interface SolutionAction {
  id: string;
  actionKey: string;
  whatsappMessageId: string;
  ticketId: number;
  conversationId: string;
  phoneE164: string;
  action: SolutionActionType;
  status: SolutionActionStatus;
  previousTicketStatus: number | null;
  finalTicketStatus: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReserveSolutionActionInput {
  actionKey: string;
  whatsappMessageId: string;
  ticketId: number;
  conversationId: string;
  phoneE164: string;
  action: SolutionActionType;
  previousTicketStatus: number | null;
}

export interface ReserveSolutionActionResult {
  reserved: boolean;
  action: SolutionAction;
}

export interface SolutionActionRepository {
  reserveAction(input: ReserveSolutionActionInput): Promise<ReserveSolutionActionResult>;
  markSuccess(id: string, finalTicketStatus: number): Promise<void>;
  markError(id: string, errorCode: string, errorMessage: string): Promise<void>;
  markIgnored(id: string, errorCode: string, errorMessage: string): Promise<void>;
  findByWhatsappMessageId(messageId: string): Promise<SolutionAction | null>;
  findSuccessfulAction(actionKey: string): Promise<SolutionAction | null>;
}
