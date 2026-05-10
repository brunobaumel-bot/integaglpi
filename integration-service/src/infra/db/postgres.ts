import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { Pool } from 'pg';

import { env } from '../../config/env.js';
import { logger } from '../logger/logger.js';
import { DATABASE_SCHEMA_LOCK_ID } from './databaseConstants.js';

export interface SqlExecutor {
  query<R extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<R>>;
}

export const postgresPool = new Pool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  database: env.DB_NAME,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  ssl: env.DB_SSL ? { rejectUnauthorized: false } : undefined,
});

export async function withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await postgresPool.connect();

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function checkDatabaseConnection(): Promise<void> {
  await postgresPool.query('SELECT 1');
}

const initDbSqlPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../init-db.sql');
const schemaMigrationsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../schema-migrations');
export const CRITICAL_SCHEMA_MIGRATIONS = [
  '003_messages_media_info.sql',
  '004_solution_actions.sql',
  '005_audit_events.sql',
] as const;

export function parseSqlStatements(sql: string): string[] {
  return sql
    .replace(/^\s*--.*$/gm, '')
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

export function sortSchemaMigrationFiles(files: string[]): string[] {
  return files
    .filter((name) => name.endsWith('.sql'))
    .sort();
}

export async function listSchemaMigrationFiles(directory = schemaMigrationsDir): Promise<string[]> {
  let files: string[];
  try {
    files = sortSchemaMigrationFiles(await readdir(directory));
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Schema migrations directory not found: ${directory}`);
    }

    throw error;
  }

  const missingCriticalMigrations = CRITICAL_SCHEMA_MIGRATIONS.filter((name) => !files.includes(name));
  if (missingCriticalMigrations.length > 0) {
    throw new Error(`Critical schema migrations missing: ${missingCriticalMigrations.join(', ')}`);
  }

  return files;
}

export async function ensureDatabaseSchema(): Promise<void> {
  const client = await postgresPool.connect();

  try {
    const initDbSql = await readFile(initDbSqlPath, 'utf8');
    const statements = parseSqlStatements(initDbSql);

    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [DATABASE_SCHEMA_LOCK_ID.toString()]);

    logger.info(
      {
        initDbSqlPath,
        statements: statements.length,
      },
      'Ensuring PostgreSQL schema from init-db.sql.',
    );

    for (const [index, statement] of statements.entries()) {
      await client.query(statement);
      logger.debug(
        {
          statementIndex: index + 1,
          statementPreview: statement.slice(0, 120),
        },
        'Verified PostgreSQL schema statement.',
      );
    }

    const patchFiles = await listSchemaMigrationFiles(schemaMigrationsDir);

    for (const patchFile of patchFiles) {
      const patchSql = await readFile(join(schemaMigrationsDir, patchFile), 'utf8');
      const patchStatements = parseSqlStatements(patchSql);
      for (const [index, statement] of patchStatements.entries()) {
        await client.query(statement);
        logger.debug(
          {
            patchFile,
            statementIndex: index + 1,
            statementPreview: statement.slice(0, 120),
          },
          'Applied schema migration statement.',
        );
      }
      logger.info({ patchFile, statements: patchStatements.length }, 'Applied schema migration file.');
    }

    await client.query('COMMIT');
    logger.info(
      {
        initDbSqlPath,
        statements: statements.length,
      },
      'PostgreSQL schema ensured successfully.',
    );
  } catch (error: unknown) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError: unknown) {
      logger.error({ rollbackError }, 'Failed to rollback PostgreSQL schema transaction.');
    }

    logger.error(
      {
        error,
        initDbSqlPath,
      },
      'Failed to ensure PostgreSQL schema.',
    );
    throw error;
  } finally {
    client.release();
  }
}
