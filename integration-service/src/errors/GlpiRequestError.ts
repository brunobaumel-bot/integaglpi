/** Etapas possíveis no inbound; `glpi_init_session` / `ai_analysis` reservados ao fluxo atual. */
export type GlpiFailureStage =
  | 'glpi_init_session'
  | 'glpi_contact_lookup'
  | 'glpi_user_lookup'
  | 'glpi_user_create'
  | 'glpi_ticket_create'
  | 'glpi_ticket_read'
  | 'glpi_ticket_update'
  | 'glpi_solution_read'
  | 'glpi_solution_approve'
  | 'glpi_solution_reopen'
  | 'glpi_followup_create'
  | 'glpi_document_upload'
  | 'glpi_document_item_link'
  | 'ai_analysis';

export class GlpiRequestError extends Error {
  public constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly responseBody?: unknown,
    public readonly stage?: GlpiFailureStage,
    /** URL efetiva do pedido GLPI (já sanitizada para log). */
    public readonly requestUrl?: string,
  ) {
    super(message);
    this.name = 'GlpiRequestError';
  }
}
