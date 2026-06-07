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

export interface GlpiComputerHardwareUpdate {
  serial?: string | null;
  manufacturers_id?: number | null;
  computermodels_id?: number | null;
  comment?: string | null;
}

/** Payload sent to the PHP bridge computer.hardware.sync.php. No PII fields. */
export interface GlpiComputerHardwarePayload {
  service_tag?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  memory_mb?: number | null;
  processors?: Array<{
    type: string | null;
    number_of_cores: number | null;
    number_of_processors: number | null;
    speed_mhz: number | null;
  }>;
  drives?: Array<{
    name: string | null;
    capacity_mb: number | null;
    serial_number: string | null;
  }>;
  /** Only included when LOGMEIN_SYNC_LOCAL_IP=true. */
  network_connections?: Array<{
    name: string | null;
    mac_address: string | null;
    ip_address?: string | null;
  }>;
}

// ── LogMeIn Field Mapping Configuration ──────────────────────────────────────

/** How the sync handles an already-populated field in GLPI. */
export type LogmeinOverwritePolicy =
  | 'never_overwrite_manual'        // never overwrite any existing value
  | 'overwrite_only_logmein_origin' // overwrite only when the current value was set by LogMeIn
  | 'always_update';                // always overwrite (requires audit; avoid as default)

/** Where in GLPI the field value will land. */
export type LogmeinGlpiTargetType =
  | 'computer_field'
  | 'device_processor'
  | 'device_memory'
  | 'device_harddisk'
  | 'network_port';

/** A single field mapping entry stored in logmein_field_mapping_config. */
export interface LogmeinFieldMapping {
  id: number;
  logmeinFieldKey: string;
  glpiTargetType: LogmeinGlpiTargetType;
  glpiTargetField: string;
  overwritePolicy: LogmeinOverwritePolicy;
  isActive: boolean;
  /** Name of env flag required to activate this field (e.g. 'LOGMEIN_SYNC_LOCAL_IP'). */
  requiresFlag: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Result of a single field in a dry-run evaluation. */
export type LogmeinFieldDryRunStatus =
  | 'would_update'       // field would be written/created
  | 'would_skip'         // field has no value from LM or mapping is inactive
  | 'blocked_by_policy'  // policy prevents overwriting the current GLPI value
  | 'field_unavailable'  // LM did not return data for this field
  | 'blocked_pii'        // field is in the PII block list
  | 'blocked_flag'       // required env flag is not set
  | 'blocked_forbidden'; // field is explicitly prohibited regardless of config

/** Per-field outcome for a dry-run preview. */
export interface LogmeinFieldDryRunResult {
  logmeinFieldKey: string;
  glpiTargetType: string;
  glpiTargetField: string;
  overwritePolicy: LogmeinOverwritePolicy | null;
  status: LogmeinFieldDryRunStatus;
  currentGlpiValue: string | null;
  proposedValue: string | null;
}

/** Complete dry-run report for one host/computer pair. */
export interface LogmeinHardwareDryRun {
  logmeinHostId: number;
  glpiComputerId: number;
  fields: LogmeinFieldDryRunResult[];
  wouldUpdate: number;
  wouldSkip: number;
  blockedByPolicy: number;
  fieldUnavailable: number;
  blockedForbidden: number;
  dryRunOnly: true;
}

export interface GlpiComputerAssetCandidate {
  id: number;
  name: string | null;
  serial: string | null;
  otherserial: string | null;
  entitiesId: number | null;
}

/**
 * Contexto seguro de um Computer GLPI para resumo técnico ao atendente.
 * Não inclui serial, MAC, IP, usuários locais ou outros dados sensíveis.
 * PHASE: integaglpi_asset_context_summary_001
 */
export interface GlpiComputerContext {
  computerId: number;
  hostname: string | null;
  entityId: number | null;
  entityName: string | null;
  manufacturer: string | null;
  model: string | null;
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
