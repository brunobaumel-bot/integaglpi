export interface ActiveRoutingOption {
  id: number;
  label: string;
  optionKey: string;
  queueId: number | null;
  glpiGroupId: number | null;
  glpiUserId: number | null;
  confirmationMessage: string | null;
  sortOrder: number;
  /** ID nativo da categoria ITIL do GLPI — preenchido apenas quando a triagem nativa está ativa. */
  glpiItilCategoryId?: number | null;
  /** ID nativo do Form do GLPI — preenchido quando NATIVE_GLPI_TRIAGE_SOURCES inclui "form". */
  glpiFormId?: number | null;
}

/** Primeira opção de roteamento ativa vinculada à fila informada. */
export interface RoutingQueueAssignment {
  routingOptionId: number;
  queueId: number;
  glpiGroupId: number | null;
  glpiUserId: number | null;
}

export interface RoutingRepository {
  getActiveOptions(): Promise<ActiveRoutingOption[]>;
  findAssignmentByQueueId(queueId: number): Promise<RoutingQueueAssignment | null>;
}
