export interface GlpiContactLookupResult {
  glpiContactId: number | null;
  glpiUserId: number | null;
  name: string | null;
}

export interface CreateGlpiTicketInput {
  title: string;
  content: string;
  requesterPhone: string;
  requesterName: string | null;
  /** GLPI `_users_id_assign` quando informado. */
  assignedUserId?: number | null;
  /** GLPI `_groups_id_assign` quando informado e sem usuário de atribuição. */
  assignedGroupId?: number | null;
}

export interface AddGlpiFollowUpInput {
  ticketId: number;
  content: string;
}

export interface UploadGlpiDocumentInput {
  fileBuffer: Buffer;
  filename: string;
  mimeType: string;
}

export interface GlpiTicket {
  id: number;
  status: number | null;
}
