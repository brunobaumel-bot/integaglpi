import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadHistoricalMiningDataset, validateHistoricalWindow } from '../src/historicalMining/input.js';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'integaglpi-hist-mining-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function validRow(overrides: Record<string, unknown> = {}) {
  return {
    ticket_id_hash: '2112319297',
    opened_at: '2026-01-10T10:00:00.000Z',
    solved_at: '2026-01-11T10:00:00.000Z',
    status: 'solved',
    category: 'Ativacao',
    entity: 'Etica',
    group: 'Suporte',
    title_text_sanitized: 'Ativacao do sistema',
    description_text_sanitized: 'Cliente pediu ativacao com email teste@example.com',
    followup_text_sanitized: 'Followup sem dados sensiveis',
    solution_text_sanitized: 'Procedimento aplicado e validado',
    reopened_count: 0,
    ...overrides,
  };
}

describe('historical mining input contract', () => {
  it('loads JSONL, filters by window and respects max rows', async () => {
    const input = join(tempDir, 'tickets.jsonl');
    await writeFile(input, [
      JSON.stringify(validRow({ ticket_id_hash: '1', opened_at: '2025-01-01T00:00:00.000Z' })),
      JSON.stringify(validRow({ ticket_id_hash: '2' })),
      JSON.stringify(validRow({ ticket_id_hash: '3', category: 'Rede' })),
    ].join('\n'), 'utf8');

    const dataset = await loadHistoricalMiningDataset(input, {
      windowStart: new Date('2026-01-01T00:00:00.000Z'),
      windowEnd: new Date('2026-12-31T23:59:59.000Z'),
      maxRows: 1,
    });

    expect(dataset.rowsSeen).toBe(2);
    expect(dataset.records).toHaveLength(1);
    expect(dataset.records[0].ticketIdHash).toMatch(/^[a-f0-9]{64}$/);
    expect(dataset.records[0].descriptionText).toContain('[EMAIL]');
  });

  it('loads CSV and rejects invalid rows', async () => {
    const input = join(tempDir, 'tickets.csv');
    await writeFile(input, [
      'ticket_id_hash,opened_at,status,category,entity,group,title_text_sanitized,description_text_sanitized,followup_text_sanitized,solution_text_sanitized,reopened',
      'abc,2026-02-01T00:00:00.000Z,solved,Email,Etica,Suporte,Titulo,Descricao,Follow,Solution,true',
      'def,,solved,Email,Etica,Suporte,Titulo,Descricao,Follow,Solution,false',
    ].join('\n'), 'utf8');

    const dataset = await loadHistoricalMiningDataset(input, { maxRows: 10 });

    expect(dataset.rowsSeen).toBe(2);
    expect(dataset.rowsRejected).toBe(1);
    expect(dataset.records).toHaveLength(1);
    expect(dataset.records[0].reopenedCount).toBe(1);
  });

  it('rejects invalid windows', () => {
    expect(() => validateHistoricalWindow(new Date('2026-02-01'), new Date('2026-01-01'))).toThrow(
      'HISTORICAL_MINING_INVALID_WINDOW_RANGE',
    );
  });
});
