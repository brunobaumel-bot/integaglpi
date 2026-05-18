import type { ContactEntityMemory, ContactEntityMemoryRepository, RememberContactEntityInput } from '../../domain/repositories/ContactEntityMemoryRepository.js';
import { DATABASE_TABLES } from '../../infra/db/databaseConstants.js';
import type { SqlExecutor } from '../../infra/db/postgres.js';

interface ContactEntityMemoryRow {
  id: string;
  phone_e164: string;
  contact_id: string | null;
  glpi_entity_id: number | string;
  glpi_entity_name: string | null;
  source_ticket_id: number | string | null;
  source_conversation_id: string | null;
  source: string | null;
  is_active: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}

export class PostgresContactEntityMemoryRepository implements ContactEntityMemoryRepository {
  public constructor(private readonly executor: SqlExecutor) {}

  public async findActiveByPhone(phoneE164: string): Promise<ContactEntityMemory | null> {
    const result = await this.executor.query<ContactEntityMemoryRow>(
      `
        SELECT
          id,
          phone_e164,
          contact_id,
          glpi_entity_id,
          glpi_entity_name,
          source_ticket_id,
          source_conversation_id,
          source,
          is_active,
          created_at,
          updated_at
        FROM ${DATABASE_TABLES.contactEntityMemory}
        WHERE phone_e164 = $1
          AND is_active = TRUE
        LIMIT 1
      `,
      [phoneE164],
    );

    return result.rowCount ? this.mapRow(result.rows[0]) : null;
  }

  public async rememberEntityForPhone(input: RememberContactEntityInput): Promise<ContactEntityMemory> {
    const result = await this.executor.query<ContactEntityMemoryRow>(
      `
        WITH deactivated AS (
          UPDATE ${DATABASE_TABLES.contactEntityMemory}
          SET is_active = FALSE,
              updated_at = NOW()
          WHERE phone_e164 = $1
            AND is_active = TRUE
          RETURNING id
        )
        INSERT INTO ${DATABASE_TABLES.contactEntityMemory} (
          phone_e164,
          contact_id,
          glpi_entity_id,
          glpi_entity_name,
          source_ticket_id,
          source_conversation_id,
          source,
          is_active,
          created_at,
          updated_at
        )
        SELECT $1, $2, $3, $4, $5, $6, $7, TRUE, NOW(), NOW()
        FROM (SELECT count(*) FROM deactivated) AS deactivation_guard
        RETURNING
          id,
          phone_e164,
          contact_id,
          glpi_entity_id,
          glpi_entity_name,
          source_ticket_id,
          source_conversation_id,
          source,
          is_active,
          created_at,
          updated_at
      `,
      [
        input.phoneE164,
        input.contactId ?? null,
        input.glpiEntityId,
        input.glpiEntityName ?? null,
        input.sourceTicketId ?? null,
        input.sourceConversationId ?? null,
        input.source ?? 'manual',
      ],
    );

    return this.mapRow(result.rows[0]);
  }

  private mapRow(row: ContactEntityMemoryRow): ContactEntityMemory {
    return {
      id: row.id,
      phoneE164: row.phone_e164,
      contactId: row.contact_id,
      glpiEntityId: Number(row.glpi_entity_id),
      glpiEntityName: row.glpi_entity_name,
      sourceTicketId: row.source_ticket_id === null ? null : Number(row.source_ticket_id),
      sourceConversationId: row.source_conversation_id,
      source: row.source ?? 'manual',
      isActive: row.is_active,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}
