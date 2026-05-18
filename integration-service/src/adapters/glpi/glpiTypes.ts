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
  /** GLPI `entities_id` real do ticket. Deve ser inteiro > 0; entidade raiz/global não é permitida. */
  entitiesId: number;
  /** GLPI `_users_id_assign` quando informado. */
  assignedUserId?: number | null;
  /** GLPI `_groups_id_assign` quando informado e sem usuário de atribuição. */
  assignedGroupId?: number | null;
  /** GLPI `_users_id_requester` quando o contato foi vinculado/criado de forma segura. */
  requesterUserId?: number | null;
}

export interface FindGlpiTicketForEntitySelectionInput {
  correlationMarker: string | null;
  requesterPhone: string;
  entitiesId: number;
}

export interface GlpiUserLookupResult {
  id: number;
  name: string | null;
  isActive: boolean;
  email: string | null;
}

export interface CreateRestrictedGlpiUserInput {
  email: string;
  requesterName: string | null;
  companyName: string | null;
  phoneE164: string;
  entitiesId: number;
}

export interface AddGlpiFollowUpInput {
  ticketId: number;
  content: string;
}

export interface UploadGlpiDocumentInput {
  fileBuffer: Buffer;
  filename: string;
  mimeType: string;
  /** Entidade real do ticket onde o documento sera anexado. */
  entitiesId?: number | null;
}

export interface GlpiTicket {
  id: number;
  status: number | null;
  entitiesId: number | null;
}
