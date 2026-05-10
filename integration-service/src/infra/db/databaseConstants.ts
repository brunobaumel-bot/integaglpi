export const DATABASE_PREFIX = 'glpi_plugin_integaglpi_';

export const DATABASE_TABLES = {
  contacts: `${DATABASE_PREFIX}contacts`,
  conversations: `${DATABASE_PREFIX}conversations`,
  messages: `${DATABASE_PREFIX}messages`,
  webhookEvents: `${DATABASE_PREFIX}webhook_events`,
  queues: `${DATABASE_PREFIX}queues`,
  routingOptions: `${DATABASE_PREFIX}routing_options`,
  configs: `${DATABASE_PREFIX}configs`,
  solutionActions: `${DATABASE_PREFIX}solution_actions`,
  auditEvents: `${DATABASE_PREFIX}audit_events`,
} as const;

export const DATABASE_SCHEMA_LOCK_ID = 81234756120345n;
