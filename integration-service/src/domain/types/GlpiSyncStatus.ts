export const GLPI_SYNC_STATUSES = ['not_sent', 'synced', 'error'] as const;

export type GlpiSyncStatus = (typeof GLPI_SYNC_STATUSES)[number];
