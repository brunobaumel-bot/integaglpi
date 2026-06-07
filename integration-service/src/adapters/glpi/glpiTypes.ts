export interface GlpiContactLookupResult {
  glpiContactId: number | null;
  glpiUserId: number | null;
  name: string | null;
}

export interface GlpiItilCategory {
  id: number;
  name: string;
  completename: string;
  is_helpdeskvisible: boolean;
}

export interface GlpiComputerAssetCandidate {
  id: number;
  name: string | null;
  serial: string | null;
  otherserial: string | null;
  entitiesId: number | null;
}

/**
 * Formulário nativo do GLPI (glpi_forms_forms).
 * Retornado pelo endpoint PHP integaglpi/front/form.catalog.php.
 *
 * PHASE: integaglpi_v8_service_catalog_gap_fix_and_bridge_001
 */
export interface GlpiForm {
  id: number;
  name: string;
  entitiesId: number;
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
  /** GLPI `itilcategories_id` — preenchido quando a triagem nativa GLPI está ativa. */
  itilcategoriesId?: number | null;
  /** ID nativo do Form do GLPI selecionado na triagem — armazenado para rastreabilidade. */
  glpiFormId?: number | null;
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
