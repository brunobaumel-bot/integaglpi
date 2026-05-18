export interface ActiveRoutingOption {
  id: number;
  label: string;
  optionKey: string;
  queueId: number | null;
  glpiGroupId: number | null;
  glpiUserId: number | null;
  confirmationMessage: string | null;
  sortOrder: number;
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
