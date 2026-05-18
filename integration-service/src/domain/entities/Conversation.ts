export interface Conversation {
  id: string;
  phoneE164: string;
  contactId: string;
  glpiTicketId: number | null;
  /** Entidade GLPI usada para criar/vincular o chamado, quando definida. */
  glpiEntityId?: number | null;
  glpiEntityName?: string | null;
  /** Fila escolhida no roteamento inbound (PostgreSQL queue id). */
  queueId: number | null;
  /** Subestado persistido da Recepcao Inteligente. */
  profileCollectionState?: Record<string, unknown> | null;
  status: string;
  lastMessageAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

