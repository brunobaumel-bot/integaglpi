CREATE TABLE IF NOT EXISTS glpi_plugin_whatsapp_contacts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    phone_e164 VARCHAR(32) NOT NULL UNIQUE,
    glpi_contact_id BIGINT,
    glpi_user_id BIGINT,
    name VARCHAR(255),
    source VARCHAR(64) NOT NULL,
    cache_key VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS glpi_plugin_whatsapp_conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    phone_e164 VARCHAR(32) NOT NULL,
    contact_id UUID NOT NULL REFERENCES glpi_plugin_whatsapp_contacts(id),
    glpi_ticket_id BIGINT,
    status VARCHAR(32) NOT NULL,
    last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS glpi_plugin_whatsapp_conversations_contact_status_idx
    ON glpi_plugin_whatsapp_conversations (contact_id, status, last_message_at DESC);

CREATE TABLE IF NOT EXISTS glpi_plugin_whatsapp_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID REFERENCES glpi_plugin_whatsapp_conversations(id),
    message_id VARCHAR(128) NOT NULL,
    direction VARCHAR(16) NOT NULL,
    sender_phone VARCHAR(32) NOT NULL,
    recipient_phone VARCHAR(32) NOT NULL,
    message_type VARCHAR(32) NOT NULL,
    message_text TEXT,
    raw_payload JSONB NOT NULL,
    processing_status VARCHAR(32) NOT NULL,
    glpi_sync_status VARCHAR(32) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS glpi_plugin_whatsapp_messages_message_id_uq
    ON glpi_plugin_whatsapp_messages (message_id);

CREATE INDEX IF NOT EXISTS glpi_plugin_whatsapp_messages_conversation_idx
    ON glpi_plugin_whatsapp_messages (conversation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS glpi_plugin_whatsapp_webhook_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id VARCHAR(191) NOT NULL,
    event_type VARCHAR(64) NOT NULL,
    payload JSONB NOT NULL,
    signature_valid BOOLEAN NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processing_status VARCHAR(32) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS glpi_plugin_whatsapp_webhook_events_event_id_uq
    ON glpi_plugin_whatsapp_webhook_events (event_id);

