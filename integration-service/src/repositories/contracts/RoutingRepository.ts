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

export interface RoutingRepository {
  getActiveOptions(): Promise<ActiveRoutingOption[]>;
}
