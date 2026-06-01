-- V7 Phase: integaglpi_v7_logmein_remote_access_evidence_reconciliation_001
-- LogMeIn remote-access session ledger + regularization queue.
-- Additive, idempotent (CREATE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS).
-- DO NOT execute automatically; apply manually after human review.

-- ── Ledger ─────────────────────────────────────────────────────────────────
-- One row per LogMeIn sessionId. Populated read-only from the reports API.
-- No access is initiated here. IP and technician are stored as hashes only.

CREATE TABLE IF NOT EXISTS glpi_plugin_integaglpi_logmein_remote_sessions (
    id                   BIGSERIAL    PRIMARY KEY,
    session_id           TEXT         NOT NULL,         -- LogMeIn sessionId (unique per API)
    host_external_id     TEXT         NOT NULL DEFAULT '',
    group_external_id    TEXT         NOT NULL DEFAULT '',
    group_name           TEXT         NOT NULL DEFAULT '',
    host_name_sanitized  TEXT         NOT NULL DEFAULT '',
    session_start_at     TIMESTAMPTZ,
    session_end_at       TIMESTAMPTZ,
    duration_seconds     INT          NOT NULL DEFAULT 0,
    equipment_tag        TEXT,                          -- from asset cache lookup
    glpi_entity_id       BIGINT,                        -- matched entity (from group map)
    glpi_ticket_id       BIGINT,                        -- matched ticket (set after review)
    technician_hash      TEXT,                          -- SHA-256(userId) — no plaintext
    match_status         TEXT         NOT NULL DEFAULT 'pending_user_review',
    -- allowed: pending_user_review | no_ticket_found | no_entity_mapping |
    --          matched_ticket | ignored_duplicate | out_of_scope | resolved
    match_confidence     TEXT,                          -- high | medium | low | none
    source_window_from   DATE,                          -- report fetch window start
    source_window_to     DATE,                          -- report fetch window end
    source_snapshot_hash TEXT,                          -- SHA-256 of raw response chunk (not stored)
    created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT logmein_remote_sessions_session_id_uq UNIQUE (session_id)
);

COMMENT ON TABLE glpi_plugin_integaglpi_logmein_remote_sessions IS
    'Ledger of remote-access sessions fetched read-only from the LogMeIn reports API '
    '(POST /public-api/v1/reports/remote-access-with-groups). '
    'No session is initiated from this table. IP and technician are never stored in plaintext.';

-- ── Regularization queue ───────────────────────────────────────────────────
-- One row per session that requires human review or action.
-- A row is created automatically; all resolution actions are manual.

CREATE TABLE IF NOT EXISTS glpi_plugin_integaglpi_logmein_regularization_queue (
    id                        BIGSERIAL    PRIMARY KEY,
    session_id                TEXT         NOT NULL,    -- FK to ledger (denormalized for fast query)
    status                    TEXT         NOT NULL DEFAULT 'pending_user_review',
    -- allowed: pending_user_review | no_ticket_found | no_entity_mapping |
    --          matched_ticket | ignored_duplicate | out_of_scope | resolved
    glpi_entity_id            BIGINT,
    glpi_ticket_id            BIGINT,                   -- linked after human confirmation
    glpi_task_id              BIGINT,                   -- GLPI task created after confirmation
    resolved_by_glpi_user_id  BIGINT,
    resolved_at               TIMESTAMPTZ,
    resolution_note           TEXT,                     -- sanitized, ≤ 500 chars
    created_at                TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at                TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT logmein_regularization_session_id_uq UNIQUE (session_id)
);

COMMENT ON TABLE glpi_plugin_integaglpi_logmein_regularization_queue IS
    'Human-review queue derived from the remote-access ledger. '
    'All resolution actions (link ticket, create task, ignore) require explicit operator action. '
    'No automatic ticket or WhatsApp notification is created from this table.';

-- ── Indexes ────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS logmein_remote_sessions_status_idx
    ON glpi_plugin_integaglpi_logmein_remote_sessions (match_status);

CREATE INDEX IF NOT EXISTS logmein_remote_sessions_entity_idx
    ON glpi_plugin_integaglpi_logmein_remote_sessions (glpi_entity_id);

CREATE INDEX IF NOT EXISTS logmein_remote_sessions_ticket_idx
    ON glpi_plugin_integaglpi_logmein_remote_sessions (glpi_ticket_id);

CREATE INDEX IF NOT EXISTS logmein_remote_sessions_start_at_idx
    ON glpi_plugin_integaglpi_logmein_remote_sessions (session_start_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS logmein_remote_sessions_group_idx
    ON glpi_plugin_integaglpi_logmein_remote_sessions (group_external_id);

CREATE INDEX IF NOT EXISTS logmein_regularization_status_idx
    ON glpi_plugin_integaglpi_logmein_regularization_queue (status);

CREATE INDEX IF NOT EXISTS logmein_regularization_entity_idx
    ON glpi_plugin_integaglpi_logmein_regularization_queue (glpi_entity_id);
