-- 049_logmein_alarm_guards.sql
-- Phase: integaglpi_logmein_alarm_rules_and_auto_ticket_implementation_001
-- Additive guards:
--   1. Rename host_not_seen_minutes → host_not_seen (condition_payload: not_seen_days)
--   2. Expand alarm_type constraint to include all 7 types
--   3. Add min_consecutive_checks / consecutive_check_interval_minutes (for host_offline)
-- No DROP TABLE. Constraint alteration is safe — no data loss.

BEGIN;

-- 1. Rename existing host_not_seen_minutes rows (safe if empty, idempotent if already done)
UPDATE integaglpi_logmein_alarm_rules
  SET
    alarm_type        = 'host_not_seen',
    condition_payload = (condition_payload - 'not_seen_minutes')
      || CASE
           WHEN (condition_payload->>'not_seen_minutes') IS NOT NULL
           THEN jsonb_build_object(
                  'not_seen_days',
                  GREATEST(7, COALESCE(((condition_payload->>'not_seen_minutes')::int) / 1440, 7))
                )
           ELSE '{}'::jsonb
         END
WHERE alarm_type = 'host_not_seen_minutes';

-- 2. Drop old constraint (only allows host_offline + host_not_seen_minutes)
ALTER TABLE integaglpi_logmein_alarm_rules
  DROP CONSTRAINT IF EXISTS chk_alarm_type;

-- 3. Add constraint with full set of allowed alarm types
--    Auto-ticket capable : host_offline, host_not_seen
--    Alert-only          : missing_equipment_tag, missing_entity_mapping,
--                          hardware_change, low_disk, low_memory
ALTER TABLE integaglpi_logmein_alarm_rules
  ADD CONSTRAINT chk_alarm_type CHECK (
    alarm_type IN (
      'host_offline',
      'host_not_seen',
      'missing_equipment_tag',
      'missing_entity_mapping',
      'hardware_change',
      'low_disk',
      'low_memory'
    )
  );

-- 4. Add consecutive checks columns (host_offline guard)
ALTER TABLE integaglpi_logmein_alarm_rules
  ADD COLUMN IF NOT EXISTS min_consecutive_checks INTEGER NOT NULL DEFAULT 1
    CHECK (min_consecutive_checks >= 1 AND min_consecutive_checks <= 10);

ALTER TABLE integaglpi_logmein_alarm_rules
  ADD COLUMN IF NOT EXISTS consecutive_check_interval_minutes INTEGER NOT NULL DEFAULT 5
    CHECK (consecutive_check_interval_minutes >= 5 AND consecutive_check_interval_minutes <= 1440);

-- 5. Enforce min 2 consecutive checks for any existing host_offline rules (safe update)
UPDATE integaglpi_logmein_alarm_rules
  SET min_consecutive_checks = 2
WHERE alarm_type = 'host_offline' AND min_consecutive_checks < 2;

-- 6. Enforce minimum 60-minute cooldown for auto-ticket-capable rules already created
UPDATE integaglpi_logmein_alarm_rules
  SET cooldown_minutes = 60
WHERE alarm_type IN ('host_offline', 'host_not_seen')
  AND create_ticket = true
  AND cooldown_minutes < 60;

COMMIT;
