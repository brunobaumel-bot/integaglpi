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
-- context_only/alarm_context entries do not write to GLPI; they document discovered fields for
-- dry-run, operator review, context summaries and alert-only future rules.
INSERT INTO glpi_plugin_integaglpi_logmein_field_mapping_config
  (logmein_field_key,            glpi_target_type,    glpi_target_field,   overwrite_policy,               is_active, requires_flag)
VALUES
  ('BatteryName',                'context_only',      'battery.name',      'never_overwrite_manual',        TRUE,  NULL),
  ('ServiceTag',                 'computer_field',    'serial',            'overwrite_only_logmein_origin', TRUE,  NULL),
  ('HardwareManufacturer',       'computer_field',    'manufacturer',      'overwrite_only_logmein_origin', TRUE,  NULL),
  ('HardwareModel',              'computer_field',    'model',             'overwrite_only_logmein_origin', TRUE,  NULL),
  ('CpuType',                    'device_processor',  'type',              'overwrite_only_logmein_origin', TRUE,  NULL),
  ('CpuNumberOfCores',           'device_processor',  'number_of_cores',   'overwrite_only_logmein_origin', TRUE,  NULL),
  ('CpuNumberOfProcessors',      'device_processor',  'number_of_processors','overwrite_only_logmein_origin',TRUE,  NULL),
  ('CpuSpeed',                   'device_processor',  'speed_mhz',         'overwrite_only_logmein_origin', TRUE,  NULL),
  ('DisplayDate',                'context_only',      'display.date',      'never_overwrite_manual',        TRUE,  NULL),
  ('DisplayProvider',            'context_only',      'display.provider',  'never_overwrite_manual',        TRUE,  NULL),
  ('DisplayType',                'context_only',      'display.type',      'never_overwrite_manual',        TRUE,  NULL),
  ('DisplayVersion',             'context_only',      'display.version',   'never_overwrite_manual',        TRUE,  NULL),
  ('MemorySize',                 'device_memory',     'size_mb',           'overwrite_only_logmein_origin', TRUE,  NULL),
  ('MemoryModules',              'context_only',      'memory.modules',    'never_overwrite_manual',        TRUE,  NULL),
  ('NetworkConnectionMacAddress','network_port',      'mac_address',       'overwrite_only_logmein_origin', TRUE,  NULL),
  ('NetworkConnectionName',       'context_only',      'network.name',      'never_overwrite_manual',        TRUE,  NULL),
  ('NetworkConnectionIPAddress', 'network_port',      'ip_address',        'overwrite_only_logmein_origin', FALSE, 'LOGMEIN_SYNC_LOCAL_IP'),
  ('NetworkConnectionDefaultGateway','context_only',  'network.default_gateway','never_overwrite_manual',   FALSE, 'LOGMEIN_SYNC_LOCAL_IP'),
  ('NetworkConnectionDHCPServer','context_only',      'network.dhcp_server','never_overwrite_manual',       FALSE, 'LOGMEIN_SYNC_LOCAL_IP'),
  ('NetworkConnectionPrimaryDNS','context_only',      'network.primary_dns','never_overwrite_manual',       FALSE, 'LOGMEIN_SYNC_LOCAL_IP'),
  ('NetworkConnectionPrimaryWINS','context_only',     'network.primary_wins','never_overwrite_manual',      FALSE, 'LOGMEIN_SYNC_LOCAL_IP'),
  ('NetworkConnectionSecondaryDNS','context_only',    'network.secondary_dns','never_overwrite_manual',     FALSE, 'LOGMEIN_SYNC_LOCAL_IP'),
  ('NetworkConnectionSecondaryWINS','context_only',   'network.secondary_wins','never_overwrite_manual',    FALSE, 'LOGMEIN_SYNC_LOCAL_IP'),
  ('NetworkConnectionSubnetMask','context_only',      'network.subnet_mask','never_overwrite_manual',       FALSE, 'LOGMEIN_SYNC_LOCAL_IP'),
  ('DriveCapacity',              'device_harddisk',   'capacity_mb',       'overwrite_only_logmein_origin', FALSE, NULL),
  ('DriveDiskType',              'context_only',      'drive.disk_type',   'never_overwrite_manual',        TRUE,  NULL),
  ('DriveMediaType',             'context_only',      'drive.media_type',  'never_overwrite_manual',        TRUE,  NULL),
  ('DriveName',                  'device_harddisk',   'name',              'overwrite_only_logmein_origin', FALSE, NULL),
  ('DriveSerialNumber',          'device_harddisk',   'serial_number',     'overwrite_only_logmein_origin', FALSE, NULL),
  ('MotherboardChipset',         'context_only',      'motherboard.chipset','never_overwrite_manual',       TRUE,  NULL),
  ('MotherboardMemorySlots',     'context_only',      'motherboard.memory_slots','never_overwrite_manual',  TRUE,  NULL),
  ('PartitionDrive',             'alarm_context',     'partition.drive',   'never_overwrite_manual',        TRUE,  NULL),
  ('PartitionFileSystem',        'context_only',      'partition.filesystem','never_overwrite_manual',      TRUE,  NULL),
  ('PartitionFreeSpace',         'alarm_context',     'partition.free_mb', 'never_overwrite_manual',        TRUE,  NULL),
  ('PartitionName',              'context_only',      'partition.name',    'never_overwrite_manual',        TRUE,  NULL),
  ('PartitionRaid',              'alarm_context',     'partition.raid',    'never_overwrite_manual',        TRUE,  NULL),
  ('PartitionRaidFailingDiskNumber','alarm_context', 'partition.raid_failing_disk','never_overwrite_manual',TRUE,  NULL),
  ('PartitionRaidStatus',        'alarm_context',     'partition.raid_status','never_overwrite_manual',     TRUE,  NULL),
  ('PartitionTotalSize',         'alarm_context',     'partition.total_mb','never_overwrite_manual',        TRUE,  NULL),
  ('PrimaryScreenResolution',    'context_only',      'screen.primary_resolution','never_overwrite_manual', TRUE,  NULL),
  ('HardwareAssetTag',           'computer_field',    'otherserial',       'never_overwrite_manual',        FALSE, NULL)
ON CONFLICT (logmein_field_key, glpi_target_field) DO NOTHING;
