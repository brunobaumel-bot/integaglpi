import type { SqlExecutor } from '../../infra/db/postgres.js';
import { DATABASE_TABLES } from '../../infra/db/databaseConstants.js';

export interface ManualTicketContactProfileRow {
  phone_e164: string;
  requester_name: string | null;
  email_address: string | null;
  company_name_raw: string | null;
  updated_at: Date | string;
}

export interface ManualTicketConversationRow {
  id: string;
  phone_e164: string;
  contact_id: string;
  glpi_ticket_id: number | string | null;
  status: string;
  link_origin?: string | null;
  linked_by_glpi_user_id?: number | string | null;
  linked_at?: Date | string | null;
  last_message_at: Date | string;
  created_at: Date | string;
  updated_at: Date | string;
}

export class PostgresManualTicketWhatsappRepository {
  public constructor(private readonly executor: SqlExecutor) {}

  public async findProfiles(input: {
    phoneE164?: string | null;
    email?: string | null;
    limit?: number;
  }): Promise<ManualTicketContactProfileRow[]> {
    const phone = input.phoneE164?.trim() || null;
    const email = input.email?.trim().toLowerCase() || null;
    const limit = Math.max(1, Math.min(10, input.limit ?? 5));
    if (!phone && !email) {
      return [];
    }

    const result = await this.executor.query<ManualTicketContactProfileRow>(
      `
        SELECT
          phone_e164,
          requester_name,
          email_address,
          company_name_raw,
          updated_at
        FROM ${DATABASE_TABLES.contactProfile}
        WHERE is_active = TRUE
          AND (
            ($1::text IS NOT NULL AND phone_e164 = $1::text)
            OR ($2::text IS NOT NULL AND lower(email_address) = $2::text)
          )
        ORDER BY updated_at DESC
        LIMIT $3
      `,
      [phone, email, limit],
    );

    return result.rows;
  }

  public async findOpenConflict(phoneE164: string, ticketId: number): Promise<ManualTicketConversationRow | null> {
    const result = await this.executor.query<ManualTicketConversationRow>(
      `
        SELECT *
        FROM ${DATABASE_TABLES.conversations}
        WHERE phone_e164 = $1
          AND status IN ('open', 'awaiting_queue_selection', 'awaiting_entity_selection', 'collecting_contact_profile')
          AND glpi_ticket_id IS NOT NULL
          AND glpi_ticket_id <> $2
        ORDER BY last_message_at DESC
        LIMIT 1
      `,
      [phoneE164, ticketId],
    );

    return result.rowCount ? result.rows[0] : null;
  }

  public async findReusableConversation(phoneE164: string, ticketId: number): Promise<ManualTicketConversationRow | null> {
    const result = await this.executor.query<ManualTicketConversationRow>(
      `
        SELECT *
        FROM ${DATABASE_TABLES.conversations}
        WHERE phone_e164 = $1
          AND (
            glpi_ticket_id = $2
            OR glpi_ticket_id IS NULL
            OR glpi_ticket_id = 0
          )
        ORDER BY
          CASE WHEN glpi_ticket_id = $2 THEN 0 ELSE 1 END,
          last_message_at DESC
        LIMIT 1
      `,
      [phoneE164, ticketId],
    );

    return result.rowCount ? result.rows[0] : null;
  }

  public async ensureContact(input: { phoneE164: string; name: string | null }): Promise<{ id: string }> {
    const result = await this.executor.query<{ id: string }>(
      `
        INSERT INTO ${DATABASE_TABLES.contacts} (
          phone_e164,
          glpi_contact_id,
          glpi_user_id,
          name,
          source,
          cache_key
        )
        VALUES ($1, NULL, NULL, $2, 'manual_glpi_ticket_link', $1)
        ON CONFLICT (phone_e164)
        DO UPDATE SET
          name = COALESCE(NULLIF(EXCLUDED.name, ''), ${DATABASE_TABLES.contacts}.name),
          updated_at = NOW()
        RETURNING id
      `,
      [input.phoneE164, input.name],
    );

    return result.rows[0];
  }

  public async createManualConversation(input: {
    phoneE164: string;
    contactId: string;
    ticketId: number;
    glpiUserId: number;
  }): Promise<ManualTicketConversationRow> {
    const result = await this.executor.query<ManualTicketConversationRow>(
      `
        INSERT INTO ${DATABASE_TABLES.conversations} (
          phone_e164,
          contact_id,
          glpi_ticket_id,
          status,
          last_message_at,
          link_origin,
          linked_by_glpi_user_id,
          linked_at
        )
        VALUES ($1, $2, $3, 'open', NOW(), 'manual_glpi_ticket_link', $4, NOW())
        RETURNING *
      `,
      [input.phoneE164, input.contactId, input.ticketId, input.glpiUserId],
    );

    return result.rows[0];
  }

  public async linkConversation(input: {
    conversationId: string;
    ticketId: number;
    glpiUserId: number;
  }): Promise<ManualTicketConversationRow> {
    const result = await this.executor.query<ManualTicketConversationRow>(
      `
        UPDATE ${DATABASE_TABLES.conversations}
        SET
          glpi_ticket_id = $2,
          status = 'open',
          last_message_at = NOW(),
          link_origin = 'manual_glpi_ticket_link',
          linked_by_glpi_user_id = $3,
          linked_at = COALESCE(linked_at, NOW()),
          updated_at = NOW()
        WHERE id = $1
          AND (glpi_ticket_id IS NULL OR glpi_ticket_id = 0 OR glpi_ticket_id = $2)
        RETURNING *
      `,
      [input.conversationId, input.ticketId, input.glpiUserId],
    );

    if (!result.rowCount) {
      throw new Error('MANUAL_LINK_CONVERSATION_CONFLICT');
    }

    return result.rows[0];
  }

  public async markOrphanedTicketConversations(input: {
    ticketId: number;
    reason: 'glpi_ticket_deleted' | 'glpi_ticket_missing';
  }): Promise<Array<{ id: string; phone_e164: string }>> {
    const result = await this.executor.query<{ id: string; phone_e164: string }>(
      `
        UPDATE ${DATABASE_TABLES.conversations}
        SET
          status = 'closed',
          profile_collection_state = COALESCE(profile_collection_state, '{}'::jsonb)
            || jsonb_build_object(
              'orphan_reason', $2::text,
              'orphaned_at', NOW(),
              'orphan_source', 'ManualTicketWhatsappLinkService'
            ),
          updated_at = NOW()
        WHERE glpi_ticket_id = $1
          AND status <> 'closed'
        RETURNING id, phone_e164
      `,
      [input.ticketId, input.reason],
    );

    return result.rows;
  }

  public async findLastInboundAt(conversationId: string): Promise<Date | null> {
    const result = await this.executor.query<{ created_at: Date }>(
      `
        SELECT created_at
        FROM ${DATABASE_TABLES.messages}
        WHERE conversation_id = $1
          AND direction = 'inbound'
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [conversationId],
    );

    return result.rowCount ? result.rows[0].created_at : null;
  }
}
