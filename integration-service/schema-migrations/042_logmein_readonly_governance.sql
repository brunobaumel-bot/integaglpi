-- V6-E3 LogMeIn read-only governance support.
-- Additive and idempotent only. Do not execute automatically.

CREATE TABLE IF NOT EXISTS glpi_plugin_integaglpi_logmein_group_maps (
  id BIGSERIAL PRIMARY KEY,
  logmein_group_external_id TEXT NOT NULL,
  logmein_group_name TEXT NOT NULL,
  glpi_entity_id INTEGER NOT NULL,
  confidence_score INTEGER NOT NULL DEFAULT 80 CHECK (confidence_score BETWEEN 0 AND 100),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_glpi_user_id INTEGER,
  updated_by_glpi_user_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (logmein_group_external_id, glpi_entity_id)
);

CREATE TABLE IF NOT EXISTS glpi_plugin_integaglpi_logmein_asset_cache (
  id BIGSERIAL PRIMARY KEY,
  logmein_host_external_id TEXT NOT NULL UNIQUE,
  logmein_group_external_id TEXT,
  logmein_group_name TEXT,
  host_name_sanitized TEXT,
  equipment_tag TEXT,
  status TEXT NOT NULL DEFAULT 'unknown',
  last_seen_at TIMESTAMPTZ,
  glpi_ticket_id INTEGER,
  glpi_entity_candidate_id INTEGER,
  confidence_score INTEGER NOT NULL DEFAULT 0 CHECK (confidence_score BETWEEN 0 AND 100),
  source_snapshot_hash TEXT,
  cache_created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cache_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS glpi_plugin_integaglpi_logmein_sync_audit (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  glpi_user_id INTEGER,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS glpi_plugin_integaglpi_governance_reviews (
  id BIGSERIAL PRIMARY KEY,
  review_type TEXT NOT NULL,
  status TEXT NOT NULL,
  owner_label TEXT NOT NULL,
  evidence_ref TEXT,
  notes_sanitized TEXT,
  reviewed_by_glpi_user_id INTEGER,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_integaglpi_logmein_asset_ticket
  ON glpi_plugin_integaglpi_logmein_asset_cache (glpi_ticket_id);

CREATE INDEX IF NOT EXISTS idx_integaglpi_logmein_asset_group
  ON glpi_plugin_integaglpi_logmein_asset_cache (logmein_group_external_id);

CREATE INDEX IF NOT EXISTS idx_integaglpi_logmein_group_maps_active
  ON glpi_plugin_integaglpi_logmein_group_maps (logmein_group_external_id, is_active);
