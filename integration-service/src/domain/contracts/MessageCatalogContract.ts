export const NODE_MESSAGE_CATALOG_KEYS = [
  'menu_message',
  'invalid_option_message',
  'invalid_media_message',
  'error_fallback_message',
  'ticket_created_message',
  'conversation_closed_message',
  'after_hours_message',
] as const;

export type NodeMessageCatalogKey = (typeof NODE_MESSAGE_CATALOG_KEYS)[number];

export const MESSAGE_CATALOG_BOUNDARY_CONTRACT = {
  producer: 'integaglpi PluginConfigService.saveMessageConfig',
  sync: 'integaglpi ExternalSettingsSyncService.syncMessageSettings',
  consumer: 'integration-service SettingsService.getMessage/formatMessage',
  storageContext: 'message',
  placeholders: ['ticket_id'],
  phpOwns: ['GLPI UI', 'CSRF/RBAC', 'GLPI-side configuration form'],
  nodeOwns: ['runtime message fallback', 'WhatsApp/FSM usage', 'PostgreSQL runtime read'],
} as const;
