export const DATABASE_PREFIX = 'glpi_plugin_integaglpi_';

export const DATABASE_TABLES = {
  contacts: `${DATABASE_PREFIX}contacts`,
  conversations: `${DATABASE_PREFIX}conversations`,
  messages: `${DATABASE_PREFIX}messages`,
  messageDeliveryStatus: `${DATABASE_PREFIX}message_delivery_status`,
  webhookEvents: `${DATABASE_PREFIX}webhook_events`,
  queues: `${DATABASE_PREFIX}queues`,
  routingOptions: `${DATABASE_PREFIX}routing_options`,
  configs: `${DATABASE_PREFIX}configs`,
  solutionActions: `${DATABASE_PREFIX}solution_actions`,
  auditEvents: `${DATABASE_PREFIX}audit_events`,
  contactEntityMemory: `${DATABASE_PREFIX}contact_entity_memory`,
  contactProfile: `${DATABASE_PREFIX}contact_profile`,
  contactImportBatches: `${DATABASE_PREFIX}contact_import_batches`,
  contactImportItems: `${DATABASE_PREFIX}contact_import_items`,
  contactImportRollbacks: `${DATABASE_PREFIX}contact_import_rollbacks`,
  conversationProfileSnapshot: `${DATABASE_PREFIX}conversation_profile_snapshot`,
  deadLetter: `${DATABASE_PREFIX}dead_letter`,
  entitySelectionAttempts: `${DATABASE_PREFIX}entity_selection_attempts`,
  inactivityTracking: `${DATABASE_PREFIX}inactivity_tracking`,
  aiQualityAnalyses: `${DATABASE_PREFIX}ai_quality_analyses`,
  messageCatalog: `${DATABASE_PREFIX}message_catalog`,
  messageCatalogAudit: `${DATABASE_PREFIX}message_catalog_audit`,
  businessHours: `${DATABASE_PREFIX}business_hours`,
  messageAutomationEvents: `${DATABASE_PREFIX}message_automation_events`,
  inactivityJobEvents: `${DATABASE_PREFIX}inactivity_job_events`,
} as const;

export const DATABASE_SCHEMA_LOCK_ID = 81234756120345n;
