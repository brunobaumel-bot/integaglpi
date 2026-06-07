-- 048_logmein_alarm_rules.sql
-- Phase: integaglpi_logmein_alarm_rules_and_auto_ticket_implementation_001
-- Additive only — no DROP / TRUNCATE / DELETE. Safe to apply on HML without downtime.
-- Three tables: alarm_rules, alarm_targets, alarm_events.

BEGIN;

-- ── Regras de alarme ──────────────────────────────────────────────────────────
-- Define quando um alarme é disparado para hosts LogMeIn.
-- enabled = false por padrão — ativação explícita obrigatória por regra.
-- glpi_entities_id > 0 é garantido por CHECK — entidade raiz/global proibida.
CREATE TABLE IF NOT EXISTS integaglpi_logmein_alarm_rules (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_name             TEXT        NOT NULL,
  alarm_type            TEXT        NOT NULL,
  enabled               BOOLEAN     NOT NULL DEFAULT false,
  cooldown_minutes      INTEGER     NOT NULL DEFAULT 30
                          CHECK (cooldown_minutes >= 1 AND cooldown_minutes <= 10080),
  condition_payload     JSONB       NOT NULL DEFAULT '{}',
  glpi_entities_id      INTEGER     NOT NULL CHECK (glpi_entities_id > 0),
  glpi_group_id         INTEGER,
  glpi_itil_category_id INTEGER,
  create_ticket         BOOLEAN     NOT NULL DEFAULT false,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_alarm_rule_name  UNIQUE (rule_name),
  CONSTRAINT chk_alarm_type      CHECK (alarm_type IN ('host_offline', 'host_not_seen_minutes'))
);

COMMENT ON TABLE integaglpi_logmein_alarm_rules IS
  'Regras de alarme para hosts LogMeIn. enabled=false por padrão. '
  'Phase: integaglpi_logmein_alarm_rules_and_auto_ticket_implementation_001';
COMMENT ON COLUMN integaglpi_logmein_alarm_rules.alarm_type IS
  '''host_offline'' — host reportado offline; ''host_not_seen_minutes'' — não visto há N minutos (condition_payload.not_seen_minutes).';
COMMENT ON COLUMN integaglpi_logmein_alarm_rules.glpi_entities_id IS
  'Entidade GLPI para abertura de chamado. Nunca 0 (raiz global proibida).';
COMMENT ON COLUMN integaglpi_logmein_alarm_rules.create_ticket IS
  'Quando true e LOGMEIN_AUTO_TICKET_ENABLED=true, abre chamado GLPI tipo Incidente.';

-- ── Alvos monitorados por regra ───────────────────────────────────────────────
-- Associação rule ↔ host_id. ON DELETE CASCADE garante limpeza automática.
CREATE TABLE IF NOT EXISTS integaglpi_logmein_alarm_targets (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id    UUID        NOT NULL REFERENCES integaglpi_logmein_alarm_rules(id) ON DELETE CASCADE,
  host_id    TEXT        NOT NULL,
  hostname   TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_alarm_target_rule_host UNIQUE (rule_id, host_id)
);

COMMENT ON TABLE integaglpi_logmein_alarm_targets IS
  'Hosts LogMeIn monitorados por cada regra de alarme.';
COMMENT ON COLUMN integaglpi_logmein_alarm_targets.host_id IS
  'logmein_host_external_id — referência lógica ao cache de ativos.';

-- ── Log de auditoria de eventos disparados ────────────────────────────────────
-- event_hash = sha256(rule_id || host_id || alarm_type || date_utc)
-- UNIQUE(event_hash) garante dedupe em nível de banco mesmo com múltiplos workers.
CREATE TABLE IF NOT EXISTS integaglpi_logmein_alarm_events (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id          UUID        NOT NULL REFERENCES integaglpi_logmein_alarm_rules(id) ON DELETE CASCADE,
  host_id          TEXT        NOT NULL,
  hostname         TEXT        NOT NULL,
  alarm_type       TEXT        NOT NULL,
  event_hash       TEXT        NOT NULL,
  glpi_ticket_id   INTEGER,
  cooldown_skipped BOOLEAN     NOT NULL DEFAULT false,
  dedupe_hit       BOOLEAN     NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_alarm_event_hash UNIQUE (event_hash)
);

COMMENT ON TABLE integaglpi_logmein_alarm_events IS
  'Log de auditoria de alarmes LogMeIn disparados. '
  'event_hash garante dedupe mesmo com múltiplos workers. '
  'Nunca grava PII de usuários/perfis/contatos.';
COMMENT ON COLUMN integaglpi_logmein_alarm_events.event_hash IS
  'sha256(rule_id || host_id || alarm_type || data_utc). Granularidade: 1 evento por regra/host/tipo/dia.';
COMMENT ON COLUMN integaglpi_logmein_alarm_events.glpi_ticket_id IS
  'ID do chamado GLPI aberto. NULL se create_ticket=false, LOGMEIN_AUTO_TICKET_ENABLED=false ou falha na criação.';

-- ── Índices ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_alarm_rules_enabled
  ON integaglpi_logmein_alarm_rules(enabled)
  WHERE enabled = true;

CREATE INDEX IF NOT EXISTS idx_alarm_targets_rule_id
  ON integaglpi_logmein_alarm_targets(rule_id);

CREATE INDEX IF NOT EXISTS idx_alarm_events_rule_id_created
  ON integaglpi_logmein_alarm_events(rule_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_alarm_events_host_id
  ON integaglpi_logmein_alarm_events(host_id);

COMMIT;
