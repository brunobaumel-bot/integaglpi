import type { Contact } from '../../domain/entities/Contact.js';
import type { SqlExecutor } from '../../infra/db/postgres.js';
import { DATABASE_TABLES } from '../../infra/db/databaseConstants.js';
import type { ContactRepository, UpsertContactInput } from '../contracts/ContactRepository.js';

import { mapContactRow } from './postgresRowMappers.js';

export class PostgresContactRepository implements ContactRepository {
  public constructor(private readonly executor: SqlExecutor) {}

  public async upsert(input: UpsertContactInput): Promise<Contact> {
    const result = await this.executor.query<Parameters<typeof mapContactRow>[0]>(
      `
        INSERT INTO ${DATABASE_TABLES.contacts} (
          phone_e164,
          glpi_contact_id,
          glpi_user_id,
          name,
          source,
          cache_key
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (phone_e164)
        DO UPDATE SET
          glpi_contact_id = EXCLUDED.glpi_contact_id,
          glpi_user_id = EXCLUDED.glpi_user_id,
          name = EXCLUDED.name,
          source = EXCLUDED.source,
          cache_key = EXCLUDED.cache_key,
          updated_at = NOW()
        RETURNING *
      `,
      [
        input.phoneE164,
        input.glpiContactId,
        input.glpiUserId,
        input.name,
        input.source,
        input.cacheKey,
      ],
    );

    return mapContactRow(result.rows[0]);
  }
}

