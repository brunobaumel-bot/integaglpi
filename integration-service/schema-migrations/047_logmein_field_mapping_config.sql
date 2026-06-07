-- 047 LogMeIn Field Mapping Configuration
-- Additive and idempotent only. Do not execute automatically.
-- Existing tables and columns from previous migrations must not be removed.
--
-- Stores the per-field governance policy for LogMeIn → GLPI hardware sync:
--   which LM fields are active, which GLPI target they write to, and
--   what overwrite policy governs each field.
--
-- PHASE: integaglpi_logmein_field_mapping_config_001

CREATE TABLE IF NOT EXISTS glpi_plugin_integaglpi_logmein_field_mapping_config (
  id                BIGSERIAL   PRIMARY KEY,
  logmein_field_key TEXT        NOT NULL,
  glpi_target_type  TEXT        NOT NULL,
  glpi_target_field TEXT        NOT NULL,
  overwrite_policy  TEXT        NOT NULL DEFAULT 'overwrite_only_logmein_origin'
                    CHECK (overwrite_policy IN (
                      'never_overwrite_manual',
                      'overwrite_only_logmein_origin',
                      'always_update'
                    )),
  is_active         BOOLEAN     NOT NULL DEFAULT TRUE,
  requires_flag     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (logmein_field_key, glpi_target_field)
);

CREATE INDEX IF NOT EXISTS idx_integaglpi_logmein_field_mapping_active
  ON glpi_plugin_integaglpi_logmein_field_mapping_config (logmein_field_key, is_active);

-- Seed safe defaults.
-- PII fields (localUsers, windowsProfiles, lastLogonUserName, externalIp) are intentionally absent.
INSERT INTO glpi_plugin_integaglpi_logmein_field_mapping_config
  (logmein_field_key,            glpi_target_type,    glpi_target_field,   overwrite_policy,               is_active, requires_flag)
VALUES
  ('ServiceTag',                 'computer_field',    'serial',            'overwrite_only_logmein_origin', TRUE,  NULL),
  ('HardwareManufacturer',       'computer_field',    'manufacturer',      'overwrite_only_logmein_origin', TRUE,  NULL),
  ('HardwareModel',              'computer_field',    'model',             'overwrite_only_logmein_origin', TRUE,  NULL),
  ('CpuType',                    'device_processor',  'type',              'overwrite_only_logmein_origin', TRUE,  NULL),
  ('CpuNumberOfCores',           'device_processor',  'number_of_cores',   'overwrite_only_logmein_origin', TRUE,  NULL),
  ('CpuSpeed',                   'device_processor',  'speed_mhz',         'overwrite_only_logmein_origin', TRUE,  NULL),
  ('MemorySize',                 'device_memory',     'size_mb',           'overwrite_only_logmein_origin', TRUE,  NULL),
  ('NetworkConnectionMacAddress','network_port',      'mac_address',       'overwrite_only_logmein_origin', TRUE,  NULL),
  ('NetworkConnectionIPAddress', 'network_port',      'ip_address',        'overwrite_only_logmein_origin', FALSE, 'LOGMEIN_SYNC_LOCAL_IP'),
  ('DriveCapacity',              'device_harddisk',   'capacity_mb',       'overwrite_only_logmein_origin', FALSE, NULL),
  ('DriveName',                  'device_harddisk',   'name',              'overwrite_only_logmein_origin', FALSE, NULL),
  ('DriveSerialNumber',          'device_harddisk',   'serial_number',     'overwrite_only_logmein_origin', FALSE, NULL),
  ('HardwareAssetTag',           'computer_field',    'otherserial',       'never_overwrite_manual',        FALSE, NULL)
ON CONFLICT (logmein_field_key, glpi_target_field) DO NOTHING;
