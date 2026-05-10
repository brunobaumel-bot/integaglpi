export interface Conversation {
  id: string;
  phoneE164: string;
  contactId: string;
  glpiTicketId: number | null;
  /** Fila escolhida no roteamento inbound (PostgreSQL queue id). */
  queueId: number | null;
  status: string;
  lastMessageAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

