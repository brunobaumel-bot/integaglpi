import { describe, expect, it } from 'vitest';

import { AiOperationsError, AiOperationsService } from '../src/domain/services/AiOperationsService.js';
import type { SqlExecutor } from '../src/infra/db/postgres.js';
import type { KeyLock } from '../src/domain/contracts/KeyLock.js';

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

const noOpLock: KeyLock = {
  async withLock(_key, work) {
    return work();
  },
};

function createService(exec: SqlExecutor = executor, lock: KeyLock = noOpLock): AiOperationsService {
  return new AiOperationsService(exec, lock);
}

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
    const service = createService();

    const result = await service.previewHistoricalMining({
      filename: 'history.jsonl',
      jsonlContent: validJsonl(),
      maxRows: 10,
      requestedBy: 7,
    });

    expect(result.dry_run_token).toMatch(/^[a-f0-9]{64}$/);
    expect(result.summary.dry_run).toBe(true);
    expect(result.summary.rows_processed).toBe(2);
    expect(result.rejection_reasons).toEqual([]);
    expect(result.preview_rows[0].excerpt).not.toMatch(/@|\+55|\d{3}\.\d{3}/);
  });

  it('accepts GLPI UI JSONL with optional followup and solution fields empty', async () => {
    const service = createService();
    const jsonl = `${JSON.stringify({
      ticket_id_hash: 'glpi-ui-ticket-1',
      opened_at: '2026-01-10 10:00:00',
      solved_at: '2026-01-10 13:00:00',
      status: 'solved',
      category: '',
      entity: '',
      group: '',
      priority: '3',
      urgency: '3',
      title_text_sanitized: 'Impressora de rede nao imprime',
      description_text_sanitized: 'Chamado sanitizado com descricao suficiente para mineracao historica',
      followup_text_sanitized: '',
      solution_text_sanitized: '',
      reopened_count: 0,
      satisfaction_score: null,
    })}\n`;

    const result = await service.previewHistoricalMining({
      filename: 'glpi-history.jsonl',
      jsonlContent: jsonl,
      maxRows: 10,
      requestedBy: 7,
    });

    expect(result.summary.rows_seen).toBe(1);
    expect(result.summary.rows_processed).toBe(1);
    expect(result.summary.rows_rejected).toBe(0);
    expect(result.rejection_reasons).toEqual([]);
  });

  it('blocks execution until the matching dry-run token is provided', async () => {
    const service = createService();

    await expect(service.executeHistoricalMining({
      filename: 'history.jsonl',
      jsonlContent: validJsonl(),
      maxRows: 10,
      requestedBy: 7,
    })).rejects.toMatchObject({
      errorCode: 'HISTORICAL_MINING_DRY_RUN_REQUIRED',
    });
  });

  it('reports invalid JSONL with a controlled rejection reason', async () => {
    const service = createService();

    const result = await service.previewHistoricalMining({
      filename: 'history.jsonl',
      jsonlContent: '{"invalid"\n',
      maxRows: 10,
    });

    expect(result.summary.rows_seen).toBe(1);
    expect(result.summary.rows_processed).toBe(0);
    expect(result.summary.rows_rejected).toBe(1);
    expect(result.rejection_reasons).toEqual([{ reason: 'invalid_json', count: 1 }]);
    expect(result.next_action).toContain('invalid_json');
  });

  it('reports empty sanitized text and schema version mismatch reasons', async () => {
    const service = createService();
    const jsonl = [
      JSON.stringify({
        ticket_id_hash: 'empty-text',
        opened_at: '2026-01-10T10:00:00.000Z',
        status: 'solved',
        category: 'Office',
        entity: 'Etica',
        group: 'Suporte',
        title_text_sanitized: '',
        description_text_sanitized: '',
        followup_text_sanitized: '',
        solution_text_sanitized: '',
      }),
      JSON.stringify({
        schema_version: 'unexpected_v2',
        ticket_id_hash: 'schema-mismatch',
        opened_at: '2026-01-10T10:00:00.000Z',
        status: 'solved',
        category: 'Office',
        entity: 'Etica',
        group: 'Suporte',
        title_text_sanitized: 'Titulo valido',
        description_text_sanitized: 'Descricao valida suficiente',
        followup_text_sanitized: '',
        solution_text_sanitized: '',
      }),
    ].join('\n');

    const result = await service.previewHistoricalMining({
      filename: 'history.jsonl',
      jsonlContent: `${jsonl}\n`,
      maxRows: 10,
    });

    expect(result.summary.rows_processed).toBe(0);
    expect(result.rejection_reasons).toEqual(expect.arrayContaining([
      { reason: 'empty_sanitized_text', count: 1 },
      { reason: 'schema_version_mismatch', count: 1 },
    ]));
  });

  it('blocks real execution when dry-run has zero processable rows', async () => {
    const service = createService();
    const preview = await service.previewHistoricalMining({
      filename: 'history.jsonl',
      jsonlContent: '{"invalid"\n',
      maxRows: 10,
    });

    await expect(service.executeHistoricalMining({
      filename: 'history.jsonl',
      jsonlContent: '{"invalid"\n',
      maxRows: 10,
      dryRunToken: preview.dry_run_token,
      requestedBy: 7,
    })).rejects.toMatchObject({
      errorCode: 'HISTORICAL_MINING_NO_PROCESSABLE_ROWS',
    });
  });

  it('uses a lock for real mining execution', async () => {
    const calls: string[] = [];
    const lock: KeyLock = {
      async withLock(key, work) {
        calls.push(key);
        return work();
      },
    };
    const service = createService(executor, lock);
    const preview = await service.previewHistoricalMining({
      filename: 'history.jsonl',
      jsonlContent: validJsonl(),
      maxRows: 10,
      requestedBy: 7,
    });

    await service.executeHistoricalMining({
      filename: 'history.jsonl',
      jsonlContent: validJsonl(),
      maxRows: 10,
      dryRunToken: preview.dry_run_token,
      requestedBy: 7,
    });

    expect(calls[0]).toMatch(/^ai_operations:historical_mining:/);
  });
});
