import { describe, expect, it } from 'vitest';

import { AiOperationsError, AiOperationsService } from '../src/domain/services/AiOperationsService.js';
import type { SqlExecutor } from '../src/infra/db/postgres.js';

const executor: SqlExecutor = {
  async query() {
    return {
      command: 'SELECT',
      rowCount: 1,
      oid: 0,
      fields: [],
      rows: [{ exists: false }],
    };
  },
};

function validJsonl(): string {
  const rows = [{
    ticket_id_hash: 'ticket-hash-1',
    opened_at: '2026-01-10T10:00:00.000Z',
    solved_at: '2026-01-10T13:00:00.000Z',
    status: 'solved',
    category: 'Office',
    entity: 'Etica',
    group: 'Suporte',
    title_text_sanitized: 'Meu Office nao esta ativando',
    description_text_sanitized: 'Office nao ativa apos troca de maquina',
    followup_text_sanitized: 'Atendimento explicou os proximos passos',
    solution_text_sanitized: 'Licenca validada e Office ativado com procedimento revisado',
    reopened_count: 0,
  }, {
    ticket_id_hash: 'ticket-hash-2',
    opened_at: '2026-01-11T10:00:00.000Z',
    solved_at: '2026-01-11T12:30:00.000Z',
    status: 'solved',
    category: 'Office',
    entity: 'Etica',
    group: 'Suporte',
    title_text_sanitized: 'Ativacao Office pendente',
    description_text_sanitized: 'Office solicita ativacao apos reinstalacao',
    followup_text_sanitized: 'Atendimento orientou validacao da licenca',
    solution_text_sanitized: 'Office ativado apos revisao do procedimento',
    reopened_count: 0,
  }];

  return `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`;
}

describe('AiOperationsService', () => {
  it('previews sanitized JSONL and returns a dry-run token without persistence', async () => {
    const service = new AiOperationsService(executor);

    const result = await service.previewHistoricalMining({
      filename: 'history.jsonl',
      jsonlContent: validJsonl(),
      maxRows: 10,
      requestedBy: 7,
    });

    expect(result.dry_run_token).toMatch(/^[a-f0-9]{64}$/);
    expect(result.summary.dry_run).toBe(true);
    expect(result.summary.rows_processed).toBe(2);
    expect(result.preview_rows[0].excerpt).not.toMatch(/@|\+55|\d{3}\.\d{3}/);
  });

  it('blocks execution until the matching dry-run token is provided', async () => {
    const service = new AiOperationsService(executor);

    await expect(service.executeHistoricalMining({
      filename: 'history.jsonl',
      jsonlContent: validJsonl(),
      maxRows: 10,
      requestedBy: 7,
    })).rejects.toMatchObject({
      errorCode: 'HISTORICAL_MINING_DRY_RUN_REQUIRED',
    });
  });

  it('rejects invalid JSONL with a controlled error', async () => {
    const service = new AiOperationsService(executor);

    await expect(service.previewHistoricalMining({
      filename: 'history.jsonl',
      jsonlContent: '{"invalid"\n',
      maxRows: 10,
    })).rejects.toBeInstanceOf(AiOperationsError);
  });
});
